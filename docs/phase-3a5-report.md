# Phase 3A-5 Report — Step-Through Debugging

## What Was Built

Phase 3A-5 delivers a step-through debugger for agents. When debug mode is enabled, agent tool calls are held for approval before executing. An approver (Claude Code via MCP tools, or a human via the REST API) sees the proposed action — which tool, what arguments, which agent — and can approve, reject, or let it timeout.

Three deliverables:

1. **Debug service** — Redis-backed hold/approve/reject mechanism with per-project mode toggle
2. **Debug routes + MCP tools** — REST API and Claude Code tools for the approver side
3. **Agent-side integration** — Python `debug_hold()` method in the patterns library and the custom agent scaffold

## How It Works

```
Debug Mode ON
─────────────

Agent decides to call rag_query("What is the refund policy?")
    │
    ▼
Agent calls POST /debug/hold
    { agent: "researcher", tool: "rag_query", args: {question: "..."} }
    │
    ▼
Server writes pending action to Redis, BLOCKS (polls for decision)
    │                                              │
    │                              Approver in Claude Code:
    │                              debug_pending → sees the action
    │                              debug_approve("abc-123")
    │                                              │
    ▼                                              ▼
Server reads decision from Redis ◂─────── Redis: decision = "approved"
    │
    ▼
Returns { decision: "approved" } to agent
    │
    ▼
Agent executes the tool call normally


Debug Mode OFF (default)
────────────────────────

POST /debug/hold returns immediately: { decision: "approved" }
No blocking, no Redis writes, zero overhead.
```

## Redis Key Structure

```
debug:{project}:enabled              — "1" if debug mode is on
debug:{project}:pending:{action_id}  — JSON of the proposed action (TTL: 10 min)
debug:{project}:decision:{action_id} — "approved" or "rejected:{reason}" (TTL: 60s)
debug:{project}:pending_ids          — list of IDs awaiting decisions
debug:{project}:notify               — pub/sub channel for real-time notifications
```

Pending actions expire after 10 minutes (if the approver never responds). Decisions expire after 60 seconds (after the agent reads them). The pending_ids list is cleaned lazily — expired entries are removed on the next `debugListPending()` call.

## The Approval Flow

### From Claude Code (MCP tools)

```
Agent is running in another terminal/container...

> Use debug_enable to start debugging
  → debug_enable: { enabled: true }
  → "Debug mode enabled for project nexus"

Agent proposes a tool call...

> Use debug_pending to see what's waiting
  → debug_pending: {
      pending: [{
        id: "1716048000123-abc",
        agent: "researcher",
        tool: "rag_query",
        args: { question: "What is the refund policy?" },
        context: "Agent searching docs",
        created_at: "2026-05-18T15:00:00Z"
      }],
      count: 1
    }

> Approve it
  → debug_approve: { id: "1716048000123-abc" }
  → "approved"

  (agent unblocks and proceeds)

OR

> Reject it
  → debug_reject: { id: "1716048000123-abc", reason: "Try a more specific query" }
  → "rejected"

  (agent receives: "Action rejected: Try a more specific query")
```

### From the REST API

```bash
# Enable debug mode
POST /debug/mode
{"enabled": true}

# Check pending actions
GET /debug/pending

# Approve
POST /debug/approve/1716048000123-abc

# Reject
POST /debug/reject/1716048000123-abc
{"reason": "Don't call external APIs yet"}

# Approve everything at once
POST /debug/approve-all

# Disable debug mode (clears all pending)
POST /debug/mode
{"enabled": false}
```

## Agent-Side Integration

### Python (via patterns library)

The `WorkbenchBus` class now has a `debug_hold()` method:

```python
bus = WorkbenchBus(project="nexus")

# In your tool handler, before executing:
decision = bus.debug_hold(
    agent="researcher",
    tool="rag_query",
    args={"question": "What is the refund policy?"},
    context="Searching for policy information",
)

if decision["decision"] == "rejected":
    return f"Action rejected: {decision.get('reason', '')}"

# Proceed with the tool call...
```

### Custom Agent Scaffold

The custom agent's `handle_tool()` function now includes a debug check before every tool execution:

```python
def handle_tool(name, inputs):
    # Hold for approval if debug mode is enabled
    decision = http.post("/debug/hold", json={
        "agent": "assistant", "tool": name, "args": inputs,
    }).json()

    if decision.get("decision") == "rejected":
        return f"Action rejected: {decision.get('reason')}"

    # Execute the tool...
```

When debug mode is OFF, this call returns instantly with `decision: "approved"` — zero overhead.

## Design Decisions

### Polling, Not WebSocket

The agent polls Redis every 500ms for a decision. A WebSocket connection would be more efficient but adds protocol complexity for a debugging feature. At 500ms polling interval, the maximum added latency per approval is 500ms — acceptable for interactive debugging where the bottleneck is human decision-making speed.

### Per-Project Mode Toggle

Debug mode is per-project, not global. You can debug one agent project while another runs uninterrupted. The toggle is stored in Redis (`debug:{project}:enabled`) and checked on every `debugHold()` call.

### Timeout as Rejection

If the approver doesn't respond within 5 minutes (configurable), the action is automatically rejected with "Timeout — no approval received." This prevents agents from hanging indefinitely if the approver disconnects.

### Pending Action TTL

Pending actions expire from Redis after 10 minutes. This prevents stale actions from accumulating if the agent crashes or disconnects mid-hold. The `debugListPending()` function lazily cleans up expired entries from the pending_ids list.

## Files Created

### Services

| File | Purpose |
|------|---------|
| `src/services/debug.ts` | Debug mode toggle, hold/approve/reject, pending list |

### Routes

| File | Purpose |
|------|---------|
| `src/routes/debug.ts` | REST endpoints for debug mode, approval, rejection, hold |

### Tests

| File | Tests |
|------|-------|
| `src/__tests__/services/debug.test.ts` | 6 tests — action shape, decision shape, key format, decision encoding |

## Files Modified

| File | Change |
|------|--------|
| `src/routes/index.ts` | Registers debug routes in `registerProjectScopedRoutes` |
| `configs/mcp/bridge/index.js` | Added 4 MCP tools: debug_enable, debug_pending, debug_approve, debug_reject |
| `templates/agent/patterns/patterns.py` | Added `debug_hold()` to WorkbenchBus class |
| `templates/multi-agent/scaffold/patterns.py` | Synced from agent/patterns/ |
| `templates/agent/frameworks/custom/scaffold/agent.py` | Added debug check in `handle_tool()` |

## MCP Tools (21 total, 4 new)

```
Phase 1:   rag_ingest, rag_query, rag_status, rag_reindex, project_test
Phase 2:   agent_remember, agent_recall, agent_forget, agent_memories
           conversation_create, conversation_list, conversation_get, conversation_append
           rag_eval
Phase 3A-3: bus_publish, bus_read, bus_channels
Phase 3A-5 (NEW):
  debug_enable      — turn debug mode on/off for the project
  debug_pending     — list actions waiting for approval
  debug_approve     — approve a pending action (let it execute)
  debug_reject      — reject a pending action (block with reason)
```

## Test Results

```
 Test Files  11 passed (11)
      Tests  113 passed (113)
```

## Typical Debug Session

```bash
# Terminal 1: Start your agent
cd ~/code/my-agent
python agent.py "Research and summarize our authentication approach"

# Terminal 2: Claude Code (approver)
> Use debug_enable to turn on debug mode
> "Debug mode enabled"

# Agent proposes: rag_query(question="authentication approach")

> Use debug_pending
> Shows: researcher wants to call rag_query with {question: "authentication approach"}

> Looks good. Use debug_approve with id "1716048000-abc"
> "Approved"

# Agent proceeds, gets RAG results, proposes next action...

> Use debug_pending
> Shows: researcher wants to call agent_remember with {key: "auth:approach", value: "JWT-based..."}

> That's fine. Use debug_approve with id "1716048001-def"

# Continue until the agent finishes...

> Use debug_enable with enabled=false to turn off debug mode
```

## Phase 3A Complete

Phase 3A (Agent Development Platform) is now complete. All five sub-phases delivered:

| Phase | Deliverable | MCP Tools Added |
|-------|------------|----------------|
| 3A-1 | Agent framework scaffolds (AutoGen, CrewAI, LangGraph, Custom) | — |
| 3A-2 | OTel instrumentation + agent trace viewer dashboard | — |
| 3A-3 | Multi-agent message bus (polling + SSE + pub/sub) | bus_publish, bus_read, bus_channels |
| 3A-4 | Orchestration patterns (sequential, parallel, hierarchical, consensus) | — |
| 3A-5 | Step-through debugging (hold/approve/reject) | debug_enable, debug_pending, debug_approve, debug_reject |

Total: 21 MCP tools, 113 tests, 189+ files.
