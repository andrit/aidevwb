# Custom Agent Development — No Framework Reference

## Why Build Without a Framework

Frameworks (AutoGen, CrewAI, LangGraph) provide pre-built abstractions for common agent patterns. Building without one gives you full control over the agent loop, message format, tool execution, and error handling. The tradeoff: more code to write, but no framework overhead, no version coupling, and complete transparency.

Choose custom when: you need precise control over the agent lifecycle, your use case doesn't fit standard patterns, you want to minimize dependencies, or you're building something the frameworks don't support well.

## The Agent Loop

Every agent, with or without a framework, runs the same basic loop:

```
1. Send messages + tool definitions to the LLM
2. Check if the response contains tool calls
3. If yes: execute tools, add results to messages, go to 1
4. If no: return the text response
```

The Anthropic SDK gives you this directly:

```python
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    system="You are a helpful assistant.",
    tools=[...],
    messages=messages,
)

# Check for tool use
tool_calls = [b for b in response.content if b.type == "tool_use"]
```

## Tool Definition Format (Anthropic)

```python
{
    "name": "search",
    "description": "Search the knowledgebase. Be specific in your query.",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"}
        },
        "required": ["query"]
    }
}
```

The `description` is critical — it's how Claude decides when to use the tool. Write it like you're explaining the tool to a colleague: what it does, when to use it, and any constraints.

## Adding State / Memory

Without a framework, you manage state yourself. Options:

**In-process dict** (lost on restart):
```python
state = {}
state["user_name"] = "Alice"
```

**Workbench memory API** (persists across sessions):
```python
http.put("/memory/user:name", json={"value": "Alice"})
name = http.get("/memory/user:name").json()["value"]
```

**File-based** (persists, human-readable):
```python
import json
with open("state.json", "w") as f:
    json.dump(state, f)
```

## Error Handling

Tool errors should return error strings to the LLM, not raise exceptions. The LLM can then decide to retry, try a different approach, or inform the user.

```python
def handle_tool(name, inputs):
    try:
        return execute(name, inputs)
    except httpx.ConnectError:
        return "Error: workbench API is not reachable. Check if it's running."
    except Exception as e:
        return f"Tool error: {e}"
```

## Guardrails

Implement guardrails as checks before and after tool execution:

```python
BLOCKED_TOOLS_IN_PRODUCTION = {"delete_user", "drop_table"}

def handle_tool(name, inputs):
    if name in BLOCKED_TOOLS_IN_PRODUCTION:
        return f"Tool '{name}' is not available in this environment."
    # ... execute ...
```

## Scaling to Multi-Agent

Without a framework, multi-agent means multiple instances of the agent loop communicating via a shared medium. Options:

- **Sequential**: run agents in order, pass output as input to the next
- **Redis pub/sub**: agents subscribe to channels and publish results
- **Database**: agents read/write to shared tables (use the workbench memory API)
- **HTTP**: agents expose endpoints and call each other

The workbench provides Redis and the memory API. Building multi-agent without a framework is more code but gives you complete control over the communication protocol.
