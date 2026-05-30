---
name: add-agent-tool
description: Define an Anthropic-format tool schema, implement the handler, wire it into the agent loop, and verify with a mock scenario
domain: agent
type: agent
triggers:
  - "add a tool to the agent"
  - "give the agent a new capability"
  - "add a tool"
  - "the agent should be able to X"
  - "define a tool"
  - "add a function the agent can call"
---

# Add an Agent Tool

## When to use

When extending an agent with a new capability — anything the agent can call during its loop. Activate when the user says "add a tool for X", "the agent should be able to search/create/send/calculate X", or "give the agent access to Y".

## Prerequisites

- Agent scaffold exists (`agent.py` with a `TOOLS` list and a `handle_tool` function)
- The capability you're adding is well-defined: what inputs does it need, what does it return?
- If calling an external service, credentials are in `.env`

## Steps

### 1. Design the tool schema

Every tool in the Anthropic API has three parts: `name`, `description`, and `input_schema`. The description is what the model reads to decide *when* to use the tool — write it from the model's perspective.

```python
# Good description — tells the model WHEN and WHAT FOR
{
    "name": "search_orders",
    "description": (
        "Search customer orders by email, order ID, or status. "
        "Use this when the user asks about their order history, "
        "order status, or wants to find a specific order."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Email address, order ID (e.g. ORD-12345), or status (pending/shipped/delivered)"
            },
            "limit": {
                "type": "integer",
                "description": "Max results to return (default 10, max 50)",
                "default": 10
            }
        },
        "required": ["query"]
    }
}
```

**Schema design rules:**
- `name`: snake_case, verb_noun format (`search_orders`, `send_email`, `create_ticket`)
- `description`: start with what it does, then when to use it, then any gotchas
- Mark only truly required fields as `"required"` — optional fields with defaults let the model use sensible defaults
- Use `"enum"` for fields with a fixed set of values
- Keep `input_schema` flat — avoid nested objects when a flat structure works

### 2. Add to the TOOLS list

```python
# agent.py — add to TOOLS list
TOOLS = [
    # ... existing tools ...
    {
        "name": "search_orders",
        "description": (
            "Search customer orders by email, order ID, or status. "
            "Use this when the user asks about their order history, "
            "order status, or wants to find a specific order."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Email address, order ID, or status filter"
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results to return",
                    "default": 10
                }
            },
            "required": ["query"]
        }
    },
]
```

### 3. Implement the handler

Add a branch to `handle_tool()`. The handler should:
- Receive `inputs: dict` (the model's chosen arguments)
- Return a `str` result (always a string — the model reads it as text)
- Handle errors gracefully and return a descriptive error string (don't raise)

```python
# agent.py — add to handle_tool()
def handle_tool(name: str, inputs: dict) -> str:
    """Execute a tool call and return the result as a string."""
    try:
        # ... debug hold (already in scaffold) ...

        if name == "rag_query":
            # ... existing handler ...

        elif name == "search_orders":
            query = inputs["query"]
            limit = inputs.get("limit", 10)

            # Call your backend / external API
            resp = http.get("/orders/search", params={"q": query, "limit": limit})

            if resp.status_code == 404:
                return f"No orders found matching '{query}'."
            if resp.status_code != 200:
                return f"Order search failed: HTTP {resp.status_code}"

            orders = resp.json().get("orders", [])
            if not orders:
                return f"No orders found matching '{query}'."

            # Format as readable text — the model will interpret this
            lines = [f"Found {len(orders)} order(s):"]
            for order in orders:
                lines.append(
                    f"  {order['id']}: {order['status']} — "
                    f"{order['item_count']} items, ${order['total']:.2f} "
                    f"(placed {order['created_at'][:10]})"
                )
            return "\n".join(lines)

        else:
            return f"Unknown tool: {name}"

    except Exception as e:
        return f"Tool error ({name}): {e}"
```

### 4. Format tool results for readability

The model reads tool results as plain text. Format them to be informative and scannable:

```python
# ✅ Good — structured, scannable
return "Order ORD-12345: shipped on 2025-01-15, delivered 2025-01-18. 3 items, $89.99 total."

# ❌ Bad — raw JSON (model can parse it but it's wasteful)
return str(resp.json())

# ❌ Bad — too terse
return "found"
```

### 5. Test the tool in isolation

Before running the full agent loop, test `handle_tool` directly with mock inputs:

```python
# test_tools.py — quick smoke test
import os
os.environ["WORKBENCH_API"] = "http://localhost:3100"
os.environ["WORKBENCH_PROJECT"] = "my-project"

from agent import handle_tool

# Test happy path
result = handle_tool("search_orders", {"query": "alice@example.com"})
print("Result:", result)
assert "order" in result.lower() or "No orders found" in result

# Test with optional param
result = handle_tool("search_orders", {"query": "ORD-99999", "limit": 5})
print("With limit:", result)

# Test error case (send invalid query)
result = handle_tool("search_orders", {"query": ""})
print("Empty query:", result)
```

Run it:
```bash
python test_tools.py
```

### 6. Test in the agent loop

```bash
python agent.py "What's the status of order ORD-12345?"
python agent.py "Show me all orders for alice@example.com"
python agent.py "Find pending orders"
```

Watch for:
- Does the model choose the new tool when appropriate?
- Does it choose the *right* inputs?
- Does the result text give the model enough to form a good answer?
- Does it avoid calling the tool for unrelated questions?

### 7. Add an eval scenario

After the tool works manually, add a scenario to lock in the behavior (see `write-agent-eval` skill):

```json
{
  "name": "uses-search-orders-for-order-questions",
  "description": "Agent should call search_orders when user asks about orders",
  "turns": [
    {
      "role": "user",
      "content": "What's the status of order ORD-12345?"
    },
    {
      "expect": {
        "tool_called": "search_orders",
        "tool_args_contain": {"query": "ORD-12345"}
      }
    }
  ]
}
```

## Templates

### Minimal tool definition

```python
{
    "name": "TOOL_NAME",
    "description": "What it does. When to use it.",
    "input_schema": {
        "type": "object",
        "properties": {
            "param": {
                "type": "string",
                "description": "What this param controls"
            }
        },
        "required": ["param"]
    }
}
```

### Handler with HTTP call and error handling

```python
elif name == "TOOL_NAME":
    param = inputs["param"]
    try:
        resp = http.post("/some/endpoint", json={"param": param})
        resp.raise_for_status()
        data = resp.json()
        return f"Success: {data['result']}"
    except httpx.HTTPStatusError as e:
        return f"Request failed: HTTP {e.response.status_code} — {e.response.text[:200]}"
    except httpx.RequestError as e:
        return f"Network error calling {name}: {e}"
```

### Tool with enum input

```python
{
    "name": "set_ticket_status",
    "description": "Update a support ticket's status.",
    "input_schema": {
        "type": "object",
        "properties": {
            "ticket_id": {"type": "string"},
            "status": {
                "type": "string",
                "enum": ["open", "in_progress", "resolved", "closed"],
                "description": "New status for the ticket"
            }
        },
        "required": ["ticket_id", "status"]
    }
}
```

## Checklist

- [ ] Tool `name` is snake_case verb_noun
- [ ] `description` explains WHEN to use it, not just WHAT it does
- [ ] Only truly required inputs are in `"required"`
- [ ] Handler added to `handle_tool()` with error handling
- [ ] Handler returns a string in all code paths (including errors)
- [ ] Tool tested in isolation (`python test_tools.py`)
- [ ] Tool tested in the agent loop with 2-3 real prompts
- [ ] Eval scenario added to lock in behavior

## Files involved

| File | Action |
|------|--------|
| `agent.py` | Add to `TOOLS` list and `handle_tool()` |
| `test_tools.py` | Create or add tool isolation test |
| `evals/scenarios.json` | Add eval scenario (see `write-agent-eval` skill) |
| `.env` | Add any new credentials needed by the tool |

## Common mistakes

**Vague description** — "Does X" is not enough. The model decides which tool to call based on the description. Be specific about when to use this tool vs others that seem similar.

**Returning raw JSON** — the model can parse JSON but it's token-inefficient and the model may over-focus on structure. Format results as human-readable text.

**Not handling errors** — if `handle_tool` raises an exception, it propagates up and crashes the agent loop. Always catch exceptions and return a descriptive error string.

**Too many required fields** — if 3 of 5 fields have sensible defaults, only mark 2 as required. Fewer required fields = the model can use the tool more easily.

**Not testing in isolation first** — running the full agent loop to test a tool is slow and expensive. Test `handle_tool` directly first to verify the implementation, then test behavior in the loop.

**Tool does too much** — if a tool does search AND create AND delete, split it into three tools. Narrow tools with clear names are easier for the model to choose correctly.
