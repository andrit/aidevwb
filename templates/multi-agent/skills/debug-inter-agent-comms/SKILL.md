---
name: debug-inter-agent-comms
description: Read bus channels to trace inter-agent message flow, identify stuck or silent agents, and fix coordination issues
domain: multi-agent
type: multi-agent
triggers:
  - "debug inter-agent communication"
  - "agents aren't communicating"
  - "check the message bus"
  - "agent is stuck"
  - "one agent isn't running"
  - "trace message flow"
  - "what did the agents say to each other"
  - "bus_read"
  - "bus_channels"
  - "the team output is wrong"
---

# Debug Inter-Agent Communications

## When to use

When a multi-agent run produced wrong output, one agent seems to have been skipped, agents got stuck, or you want to trace exactly what each agent sent and received. Activate when the user says "the team output looks wrong", "I think one agent isn't running", "trace the message flow", or "check what the agents said to each other".

## Prerequisites

- Workbench running: `make up`
- A recent multi-agent run has been executed (bus messages exist)
- Active project set via `WORKBENCH_PROJECT`

## How the Bus Works

Each agent publishes its output to a named channel on the workbench message bus when it completes. The `WorkbenchBus` client in `patterns.py` handles this automatically — every call to `sequential`, `parallel`, `hierarchical`, or `consensus` publishes agent outputs.

The bus is persistent: messages stay until the channel is deleted. This means you can inspect a run's full message history after the fact.

```
sequential run: researcher → writer
Bus channels created:
  researcher:  [{"content": "...researcher output...", "sender": "researcher", "seq": 1}]
  writer:      [{"content": "...writer output...",     "sender": "writer",     "seq": 1}]
```

---

## Steps

### 1. List all active channels

```bash
curl http://localhost:3100/bus/channels \
  -H "X-Project: your-project"
```

Or via MCP tool:
```
bus_channels
```

Expected response:
```json
{
  "channels": ["researcher", "analyst", "writer", "manager_plan"]
}
```

**Diagnosis by channel list:**

| What you see | What it means |
|-------------|---------------|
| Missing channel for an agent | That agent never ran or published nothing |
| Extra channels from old runs | Bus has history from previous runs — use `since_id` to filter |
| Only the first agent's channel | Pipeline stopped after the first agent (error or exception) |
| All expected channels present | All agents ran — check message content for quality issues |

### 2. Read a specific channel

```bash
curl -X POST http://localhost:3100/bus/read \
  -H "Content-Type: application/json" \
  -H "X-Project: your-project" \
  -d '{"channel": "researcher", "limit": 5}'
```

Or via MCP tool:
```
bus_read  channel=researcher  limit=5
```

Response:
```json
{
  "messages": [
    {
      "id": 42,
      "channel": "researcher",
      "sender": "researcher",
      "content": "Found 3 relevant documents...",
      "timestamp": "2025-01-15T10:30:01Z"
    }
  ]
}
```

### 3. Trace a full run

Read all channels in pipeline order to reconstruct the data flow:

```bash
# Step 1: What did the researcher produce?
curl -X POST http://localhost:3100/bus/read \
  -H "Content-Type: application/json" \
  -H "X-Project: your-project" \
  -d '{"channel": "researcher", "limit": 1}'

# Step 2: What did the analyst receive and produce?
curl -X POST http://localhost:3100/bus/read \
  -H "Content-Type: application/json" \
  -H "X-Project: your-project" \
  -d '{"channel": "analyst", "limit": 1}'

# Step 3: What did the writer produce?
curl -X POST http://localhost:3100/bus/read \
  -H "Content-Type: application/json" \
  -H "X-Project: your-project" \
  -d '{"channel": "writer", "limit": 1}'
```

**Shortcut — read all channels in one script:**

```python
# trace_run.py
import httpx, os, json

project = os.environ.get("WORKBENCH_PROJECT", "my-project")
api = os.environ.get("WORKBENCH_API", "http://localhost:3100")
http = httpx.Client(base_url=api, headers={"X-Project": project})

# Get all channels
channels = http.get("/bus/channels").json().get("channels", [])
print(f"Active channels: {channels}\n")

# Read latest message from each
for channel in channels:
    msgs = http.post("/bus/read", json={"channel": channel, "limit": 1}).json().get("messages", [])
    if msgs:
        msg = msgs[-1]
        content = str(msg.get("content", ""))[:300]  # truncate for display
        print(f"=== {channel} (msg #{msg['id']}) ===")
        print(content)
        print()
    else:
        print(f"=== {channel} — NO MESSAGES ===\n")
```

```bash
python trace_run.py
```

### 4. Diagnose common problems

#### Agent ran but produced empty output

**Symptom:** Channel exists but message content is empty or "Agent reached maximum tool rounds."

**Steps:**
1. Check `main.py` — does the agent have tools it needs? (`tools=["rag"]` for research agents)
2. Run the agent in isolation: `result = await researcher("your task"); print(result)`
3. Check if the knowledgebase has relevant content: `/query your task topic`
4. Add print logging to the agent:

```python
async def agent_fn(task: str) -> str:
    print(f"[{name}] Starting: {task[:100]}")
    # ... agent loop ...
    print(f"[{name}] Done: {result[:100]}")
    return result
```

#### Agent never ran (channel missing)

**Symptom:** Expected channel doesn't appear in `bus_channels`.

**Steps:**
1. Check if a previous agent in the chain raised an exception — exceptions in `async` agents may be swallowed
2. Add error logging to the pattern runner:

```python
# Wrap agent calls to catch silent failures
async def safe_agent(name: str, fn: Agent, task: str) -> str:
    try:
        result = await fn(task)
        print(f"[{name}] completed ({len(result)} chars)")
        return result
    except Exception as e:
        print(f"[{name}] FAILED: {e}")
        return f"Agent {name} failed: {e}"
```

3. Check for import errors: `python -c "from main import researcher"`

#### Hierarchical manager not delegating correctly

**Symptom:** Manager runs but worker channels are missing or wrong agents were chosen.

**Steps:**
1. Read the `manager_plan` channel to see what the manager decided:

```bash
curl -X POST http://localhost:3100/bus/read \
  -H "Content-Type: application/json" \
  -H "X-Project: your-project" \
  -d '{"channel": "manager_plan", "limit": 1}'
```

2. If the plan is malformed JSON, the hierarchical pattern may have failed to parse it
3. Check the manager's system prompt — does it list all workers and their specialties?
4. Add "Always respond with valid JSON" to the manager's prompt
5. Test the manager in isolation with a sample task:

```python
import asyncio
from main import manager

async def test():
    result = await manager(
        "Task: analyze security. Available workers: researcher, analyst, writer"
    )
    print(result)

asyncio.run(test())
```

#### Consensus judge not synthesizing

**Symptom:** All agent channels have content but the final result is empty or just echoes one agent.

**Steps:**
1. Read all agent channels to confirm they have content
2. Read the `judge` channel to see what the judge produced
3. If the judge channel is empty, the judge may be timing out (responses from all N agents become a very long context)
4. Fix: trim agent outputs before passing to judge, or lower `max_tokens` for worker agents:

```python
writer = make_agent(
    "writer",
    "... Keep your response under 300 words ...",  # ← add length constraint
)
```

#### Messages from old runs polluting the channel

**Symptom:** `bus_read` returns messages from previous runs mixed with the current run.

**Fix:** Use `since_id` to filter to messages after the last run:

```python
# Record the latest message ID before running
last_id = max((m["id"] for m in http.post("/bus/read",
    json={"channel": "researcher", "limit": 1}).json()["messages"]), default=0)

# Run the team
await main("sequential", task)

# Read only new messages
new_msgs = http.post("/bus/read",
    json={"channel": "researcher", "since_id": last_id, "limit": 10}).json()["messages"]
```

**Or clear old messages before a debug run:**
```bash
curl -X DELETE http://localhost:3100/bus/researcher \
  -H "X-Project: your-project"
```

### 5. Add structured bus logging to the team

For ongoing observability, add explicit bus publishes at key points:

```python
# main.py — add logging around each agent call
async def run_with_logging(name: str, agent_fn: Agent, task: str) -> str:
    bus.publish(f"{name}_input", sender="orchestrator", content={"task": task})
    try:
        result = await agent_fn(task)
        bus.publish(f"{name}_output", sender=name, content={"result": result, "ok": True})
        return result
    except Exception as e:
        bus.publish(f"{name}_output", sender=name, content={"error": str(e), "ok": False})
        raise
```

## Quick Reference

```bash
# List channels
curl http://localhost:3100/bus/channels -H "X-Project: PROJ"

# Read latest message from a channel
curl -X POST http://localhost:3100/bus/read \
  -H "Content-Type: application/json" -H "X-Project: PROJ" \
  -d '{"channel": "researcher", "limit": 1}'

# Clear a channel (remove all messages)
curl -X DELETE http://localhost:3100/bus/researcher -H "X-Project: PROJ"

# Read messages since a specific ID
curl -X POST http://localhost:3100/bus/read \
  -H "Content-Type: application/json" -H "X-Project: PROJ" \
  -d '{"channel": "researcher", "since_id": 42, "limit": 10}'
```

## Checklist

- [ ] `bus_channels` shows all expected agent channels
- [ ] Each agent's channel has content (not empty)
- [ ] Message content is quality output, not error strings
- [ ] For hierarchical: `manager_plan` channel shows a valid delegation plan
- [ ] For consensus: `judge` channel shows a synthesis, not just a copy of one agent
- [ ] Old messages cleared (or `since_id` used) before comparing runs
- [ ] Silent failures caught by wrapping agent calls in try/except with bus logging

## Files involved

| File | Action |
|------|--------|
| `main.py` | Add `safe_agent` wrapper, structured bus logging |
| `trace_run.py` | Create for interactive debugging sessions |

## Common mistakes

**Not clearing old messages between debug runs** — bus channels accumulate messages across runs. Without `since_id` filtering or clearing, you're reading a mix of old and new messages, making it impossible to trace a specific run.

**Reading the wrong channel name** — channel names match the first argument passed to `make_agent()` (the agent's name string). If the name is `"security_reviewer"`, the channel is `security_reviewer`, not `securityReviewer` or `security-reviewer`.

**Assuming a missing channel means a bug** — the bus only creates a channel when something is published to it. A missing channel for an agent in a hierarchical run just means the manager didn't assign that worker a task — that may be correct behavior.

**Ignoring content quality, only checking existence** — a channel with a message that says "No relevant information found" or "Agent reached maximum tool rounds" is a failure even though the channel exists. Always read and evaluate the content.
