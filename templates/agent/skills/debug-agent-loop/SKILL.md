---
name: debug-agent-loop
description: Enable step-through debug mode, inspect and approve/reject individual tool calls, diagnose infinite loops and stuck agents
domain: agent
type: agent
triggers:
  - "debug the agent"
  - "step through tool calls"
  - "agent is stuck"
  - "agent is looping"
  - "inspect what the agent is doing"
  - "debug mode"
  - "approve tool calls"
  - "reject a tool call"
  - "why is the agent calling X"
  - "agent isn't stopping"
---

# Debug the Agent Loop

## When to use

When an agent is behaving unexpectedly — calling the wrong tool, looping without stopping, producing bad results, or failing silently. Activate when the user says "the agent is stuck", "it keeps calling the same tool", "I want to see what it's doing step by step", or "why isn't it stopping?".

## Prerequisites

- Workbench services running: `make up`
- Agent scaffold uses the debug hold pattern (all workbench scaffolds include it)
- Active project set via `WORKBENCH_PROJECT`
- Two terminals: one to run the agent, one to inspect/approve tool calls

## How Step-Through Debug Works

The workbench includes a step-through debugger. When enabled, every tool call the agent makes is **held** before execution. You inspect the pending call, then either **approve** (execute the tool) or **reject** (return an error to the agent). This lets you:

- See exactly what tool the agent chose and what arguments it passed
- Approve good calls, reject bad ones, and observe how the agent responds
- Pause the loop to think about what's happening without the agent racing ahead

The debug hold is already in the scaffold — look for the `/debug/hold` POST in `handle_tool()`:

```python
decision = http.post("/debug/hold", json={
    "agent": "assistant",
    "tool": name,
    "args": inputs,
    "context": f"Agent wants to call {name}",
}).json()

if decision.get("decision") == "rejected":
    return f"Action rejected: {decision.get('reason', 'no reason given')}"
```

When debug mode is `off`, `/debug/hold` returns `{"decision": "approved"}` immediately with no delay.

---

## Steps

### 1. Enable debug mode

```bash
curl -X POST http://localhost:3100/debug/mode \
  -H "Content-Type: application/json" \
  -H "X-Project: your-project" \
  -d '{"mode": "step"}'
```

Or via MCP tool in Claude Code:
```
debug_enable
```

Modes:
- `off` — normal execution, no holds
- `step` — hold every tool call for manual approval
- `breakpoint` — hold only tool calls matching a specific tool name (set via `debug_mode.breakpoint_tool`)

### 2. Run the agent in one terminal

```bash
python agent.py "What orders does alice@example.com have?"
```

The agent will start its loop, hit the first tool call, and **pause**. The terminal will appear to hang — that's expected. It's waiting for you to approve or reject the tool call.

### 3. Check pending tool calls in another terminal

```bash
curl http://localhost:3100/debug/pending \
  -H "X-Project: your-project"
```

Response:
```json
{
  "pending": [
    {
      "id": "hold-abc123",
      "agent": "assistant",
      "tool": "search_orders",
      "args": { "query": "alice@example.com", "limit": 10 },
      "context": "Agent wants to call search_orders",
      "timestamp": "2025-01-15T10:30:00Z"
    }
  ]
}
```

Or via MCP tool:
```
debug_pending
```

### 4. Approve or reject the tool call

**Approve** — execute the tool as intended:
```bash
curl -X POST http://localhost:3100/debug/approve/hold-abc123 \
  -H "X-Project: your-project"
```

**Reject** — return an error to the agent (the agent will see "Action rejected: [reason]"):
```bash
curl -X POST http://localhost:3100/debug/reject/hold-abc123 \
  -H "Content-Type: application/json" \
  -H "X-Project: your-project" \
  -d '{"reason": "Testing what happens when search fails"}'
```

Or via MCP tools:
```
debug_approve   (with hold ID)
debug_reject    (with hold ID and reason)
```

The agent in the first terminal resumes after you approve or reject.

### 5. Approve all remaining calls at once

When you've seen enough and want the agent to finish:
```bash
curl -X POST http://localhost:3100/debug/approve-all \
  -H "X-Project: your-project"
```

### 6. Disable debug mode when done

```bash
curl -X POST http://localhost:3100/debug/mode \
  -H "Content-Type: application/json" \
  -H "X-Project: your-project" \
  -d '{"mode": "off"}'
```

---

## Diagnosing Common Problems

### Agent calls the wrong tool

**Symptom:** Agent calls `rag_query` when it should call `search_orders` for an order-related question.

**Debug steps:**
1. Enable debug mode, reproduce the prompt
2. Check the pending hold — confirm the wrong tool was chosen
3. Reject the call with `{"reason": "wrong tool — try search_orders instead"}`
4. Observe: does the agent recover and use the right tool, or does it fail?
5. Fix: compare the `description` fields of the two tools. The model chooses based on descriptions — make them more distinctive

**Fix pattern:**
```python
# Before — descriptions are too similar
"rag_query": "Search for information."
"search_orders": "Search for orders."

# After — descriptions clarify when each applies
"rag_query": (
    "Search the product knowledgebase for documentation, policies, FAQs, and "
    "product information. Use for questions about HOW the product works, "
    "pricing tiers, policies, and features. NOT for customer-specific data."
)
"search_orders": (
    "Look up orders for a specific customer. Use when the user asks about "
    "THEIR order history, order status, or a specific order ID. "
    "Requires an email address or order ID."
)
```

### Agent loops without stopping

**Symptom:** Agent keeps calling tools repeatedly, never producing a final text response. Hits `MAX_TURNS`.

**Debug steps:**
1. Enable debug mode, reproduce
2. Watch the sequence of pending tool calls — is it calling the same tool repeatedly?
3. Check what each tool returns — is it returning an error or unhelpful result that the agent re-queries?
4. Look at `MAX_TURNS` in `agent.py` — is it too high, allowing the loop to run too long?

**Common causes:**
- Tool returns empty or ambiguous result → agent retries → same result → loop
- Tool returns an error string → agent retries with slightly different args → same error
- Agent is trying to synthesize info from multiple sources but each query returns partial data

**Fix patterns:**

```python
# Fix 1: Make tool results terminal when empty
if not results:
    return "No orders found for this query. The customer may not have any orders yet."
    # NOT: return "" or return "[]" — empty results trigger re-query

# Fix 2: Return a definitive answer even for errors
except Exception as e:
    return f"Search temporarily unavailable. Please try again later or check order status at acme.com/orders"
    # NOT: return f"Error: {e}" — the agent may retry on a generic error

# Fix 3: Lower MAX_TURNS for tight agent loops
MAX_TURNS = 5   # most tasks need 1-3 turns; 10 is generous; 20+ is a bug
```

### Agent ignores tool results

**Symptom:** Tool returns good data but the agent answers incorrectly or says it couldn't find information.

**Debug steps:**
1. Approve the tool call
2. Check what the tool actually returned (add `print(f"Tool result: {result}")` to `handle_tool`)
3. Verify the result is formatted clearly as text

**Common causes:**
- Tool returns JSON dict instead of readable text → model under-uses it
- Tool result is very long → model loses the relevant part
- Tool result is ambiguous → model doesn't know how to interpret it

**Fix:**
```python
# Before — raw dict output
return str({"orders": [{"id": "123", "status": "shipped"}]})

# After — formatted, readable
lines = [f"Found {len(orders)} order(s) for {query}:"]
for order in orders:
    lines.append(f"  Order {order['id']}: {order['status']} (placed {order['date'][:10]})")
return "\n".join(lines)
```

### Agent fails silently

**Symptom:** Agent says "I was unable to find that information" but you know the data exists.

**Debug steps:**
1. Enable debug mode, reproduce
2. Check pending tool call — are the args correct?
3. Approve it — add `print` to the handler to see the raw HTTP response
4. Check the API directly: `curl http://localhost:3100/orders/search?q=alice@example.com`

**Add temporary debug logging:**
```python
elif name == "search_orders":
    resp = http.get("/orders/search", params={"q": inputs["query"]})
    print(f"[DEBUG] search_orders: status={resp.status_code}, body={resp.text[:500]}")
    # ... rest of handler
```

---

## Quick Debug Reference

```bash
# Enable step-through
curl -X POST http://localhost:3100/debug/mode -d '{"mode":"step"}' -H "X-Project: PROJ" -H "Content-Type: application/json"

# Check pending
curl http://localhost:3100/debug/pending -H "X-Project: PROJ"

# Approve one
curl -X POST http://localhost:3100/debug/approve/HOLD_ID -H "X-Project: PROJ"

# Reject one
curl -X POST http://localhost:3100/debug/reject/HOLD_ID -H "Content-Type: application/json" -H "X-Project: PROJ" -d '{"reason":"testing failure path"}'

# Approve all
curl -X POST http://localhost:3100/debug/approve-all -H "X-Project: PROJ"

# Disable
curl -X POST http://localhost:3100/debug/mode -d '{"mode":"off"}' -H "X-Project: PROJ" -H "Content-Type: application/json"
```

## Checklist

- [ ] Debug mode enabled before reproducing the issue
- [ ] Pending tool calls inspected (tool name + args) before approving
- [ ] Unexpected tool calls rejected to test agent recovery
- [ ] Tool handlers have temporary debug `print` for silent failures
- [ ] Debug mode disabled after investigation
- [ ] Root cause identified and fixed (tool description, handler format, or MAX_TURNS)
- [ ] Fix verified: reproduce original prompt, confirm correct behavior

## Files involved

| File | Action |
|------|--------|
| `agent.py` | Fix tool descriptions, handler output format, or MAX_TURNS |

## Common mistakes

**Leaving debug mode on** — debug mode holds every tool call. If you forget to disable it, the agent will appear to freeze in production. Always disable after debugging.

**Approving without inspecting** — if you approve-all immediately, you've learned nothing. Check the tool name and args before approving. The args reveal whether the model understood the request correctly.

**Forgetting to remove debug prints** — temporary `print(f"[DEBUG] ...")` statements in `handle_tool` leak internal data. Remove them after debugging.

**Not checking tool return values** — the most common silent failure is `handle_tool` returning an error string that looks plausible ("No results found") but is actually an exception swallowed by the try/except. Add logging to distinguish "genuinely no results" from "crashed silently".

**Infinite loop with MAX_TURNS too high** — `MAX_TURNS = 50` means a looping agent runs for a long time before stopping. Keep it at 5-10 for most agents; increase only if the task genuinely requires many sequential tool calls.
