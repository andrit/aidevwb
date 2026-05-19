# Phase 3A-3 Report — Multi-Agent Message Bus

## What Was Built

Phase 3A-3 delivers a Redis-backed message bus for inter-agent communication. Agents can publish messages to named channels, read message history with cursor-based polling, and subscribe to real-time streaming via SSE or Redis pub/sub.

Three access patterns, designed for different consumers:

1. **MCP tools (polling)** — for Claude Code, which is turn-based and can't hold subscriptions
2. **HTTP SSE (streaming)** — for standalone agents over HTTP, instant message delivery
3. **Redis pub/sub (streaming)** — for agents with direct Redis access, lowest latency

## Why Three Access Patterns

The constraint isn't a design choice — it's the nature of the consumers:

**Claude Code** operates turn-by-turn. When Claude calls a tool, it sends a request and waits for the response. There's no way for a tool to push unsolicited messages to Claude mid-conversation. So Claude polls: `bus_read(channel, since_id)` returns new messages since the last check. The `since_id` cursor ensures Claude doesn't re-read old messages.

**Standalone agents** (AutoGen, CrewAI, LangGraph, custom Python) run their own event loops and *can* hold open connections. The SSE endpoint (`GET /bus/:channel/stream`) streams messages in real-time over HTTP. The agent opens one HTTP connection and receives messages as they're published — no polling, no delay.

**Agents with Redis access** can subscribe directly via Redis pub/sub for the lowest possible latency. The `busSubscribe()` function returns an unsubscribe callback. This is the most efficient path but requires the agent to have an ioredis (or equivalent) dependency.

All three patterns read from the same underlying data. A message published via any method is visible to all consumers.

## Architecture

```
Agent A publishes                    Storage + Delivery                    Consumers
───────────────                    ──────────────────                    ─────────

POST /bus/publish                  Redis List (capped)                   MCP: bus_read(since_id)
  → busPublish()  ──────────────▸  bus:{project}:{channel}  ◂──────────  (polling, returns JSON)
       │                                │
       │                                │
       └── pubsubNotify() ──▸ Redis Pub/Sub ──────────▸ SSE: GET /stream
                               bus:pubsub:{project}:{channel}  (streaming, text/event-stream)
                                        │
                                        └─────────────▸ Direct: busSubscribe()
                                                        (streaming, callback)
```

### Message Storage

Messages are stored in **Redis lists**, one list per channel per project. Lists are capped at 1000 messages (LTRIM on every push). This means:

- Message history is always available (not fire-and-forget)
- Agents that come online late can read the history they missed
- Memory usage is bounded (1000 × message size per channel)

### Channel Tracking

Active channels are tracked in a Redis set (`bus:{project}:__channels__`). The `bus_channels` tool lists them. Clearing a channel removes it from the set.

### Message Format

Every message has a sequential ID (per-channel counter), sender, content (any JSON), optional metadata, and a timestamp:

```json
{
  "id": 42,
  "channel": "planning",
  "sender": "researcher",
  "content": "I found three relevant papers on transformer optimization.",
  "metadata": null,
  "timestamp": "2026-05-17T15:30:00.000Z"
}
```

The `id` field is what makes polling work — `bus_read(since_id=42)` returns messages 43, 44, 45...

## Redis Connection Refactor

Phase 3A-3 also refactored Redis connection management. Previously, the queue service created its own IORedis instance. Now there's a shared factory (`services/redis.ts`) that provides named connections:

```typescript
getRedis("bullmq")        // for BullMQ job queues
getRedis("bus")            // for message bus operations
getRedis("bus-subscriber") // for pub/sub subscriptions (requires dedicated connection)
getRedis("general")        // for ad-hoc operations
```

Each name gets its own cached IORedis instance. `closeAllRedis()` is called on graceful shutdown.

## Files Created

### Schemas

| File | Purpose |
|------|---------|
| `src/schemas/bus.ts` | ChannelName, BusPublish, BusRead, BusChannels, BusMessage, BusChannelInfo |

### Services

| File | Purpose |
|------|---------|
| `src/services/bus.ts` | busPublish, busRead, busListChannels, busClearChannel, busClearProject, busSubscribe |
| `src/services/redis.ts` | Shared Redis connection factory (getRedis, closeAllRedis) |

### Routes

| File | Purpose |
|------|---------|
| `src/routes/bus.ts` | POST /bus/publish, POST /bus/read, GET /bus/channels, DELETE /bus/:channel, GET /bus/:channel/stream (SSE) |

### Tests

| File | Tests |
|------|-------|
| `src/__tests__/schemas/bus.test.ts` | 14 tests — channel names, publish/read/channels validation, zodToJsonSchema |

## Files Modified

| File | Change |
|------|--------|
| `src/schemas/index.ts` | Re-exports bus schemas |
| `src/routes/index.ts` | Registers bus routes in registerProjectScopedRoutes |
| `src/services/queue.ts` | Refactored to use shared redis.ts factory |
| `src/index.ts` | Added closeAllRedis to shutdown handler |
| `configs/mcp/bridge/index.js` | Added bus_publish, bus_read, bus_channels tools + handlers |

## Test Results

```
 ✓ src/__tests__/schemas/phase2-schemas.test.ts (20 tests)
 ✓ src/__tests__/schemas/schemas.test.ts (19 tests)
 ✓ src/__tests__/schemas/bus.test.ts (14 tests)
 ✓ src/__tests__/lib/chunker.test.ts (11 tests)
 ✓ src/__tests__/lib/tracing.test.ts (7 tests)
 ✓ src/__tests__/lib/hash.test.ts (5 tests)
 ✓ src/__tests__/lib/templates.test.ts (15 tests)
 ✓ src/__tests__/schemas/export.test.ts (5 tests)
 ✓ src/__tests__/lib/frameworks.test.ts (7 tests)
 ✓ src/__tests__/services/conversations.test.ts (4 tests)

 Test Files  10 passed (10)
      Tests  107 passed (107)
```

## User Interfaces

### MCP Tools (17 total, 3 new)

```
Phase 1:  rag_ingest, rag_query, rag_status, rag_reindex, project_test
Phase 2:  agent_remember, agent_recall, agent_forget, agent_memories
          conversation_create, conversation_list, conversation_get, conversation_append
          rag_eval
Phase 3A-3 (NEW):
  bus_publish       — send a message to a channel
  bus_read          — read messages (with since_id cursor for polling)
  bus_channels      — list active channels
```

### REST API

```bash
# Publish a message
POST /bus/publish
{"channel": "planning", "sender": "researcher", "content": "Found 3 papers."}

# Read messages (polling — for Claude Code)
POST /bus/read
{"channel": "planning", "since_id": 0, "limit": 20}

# List channels
GET /bus/channels
GET /bus/channels?prefix=agent-

# SSE stream (for standalone agents — holds connection open)
GET /bus/planning/stream
# Response: text/event-stream
# data: {"id":1,"channel":"planning","sender":"researcher","content":"..."}
# data: {"id":2,"channel":"planning","sender":"writer","content":"..."}

# Clear a channel
DELETE /bus/planning
```

### From a Standalone Python Agent

```python
import httpx, json

http = httpx.Client(
    base_url="http://mcp-server:3100",
    headers={"X-Project": "nexus"},
)

# Publish
http.post("/bus/publish", json={
    "channel": "planning",
    "sender": "researcher",
    "content": {"findings": ["paper A", "paper B"]},
})

# Poll (for simple agents)
resp = http.post("/bus/read", json={"channel": "planning", "since_id": 0})
messages = resp.json()["messages"]

# Stream (for agents with event loops)
with httpx.stream("GET", "http://mcp-server:3100/bus/planning/stream",
                   headers={"X-Project": "nexus"}) as r:
    for line in r.iter_lines():
        if line.startswith("data: "):
            msg = json.loads(line[6:])
            print(f"{msg['sender']}: {msg['content']}")
```

### Multi-Agent Communication Pattern

```
Agent A (Researcher)                    Channel: "planning"                    Agent B (Writer)
────────────────────                    ───────────────────                    ──────────────────

bus_publish("planning",                                                       
  sender="researcher",                 [1] researcher: "Found 3 papers"       bus_read(since_id=0)
  content="Found 3 papers")                                                   → receives message 1
                                       
                                                                              bus_publish("planning",
bus_read(since_id=1)                   [2] writer: "Summarizing..."            sender="writer",
→ receives message 2                                                           content="Summarizing...")

bus_publish("results",                 
  sender="researcher",                 Channel: "results"
  content={papers: [...]})             [1] researcher: {papers: [...]}        bus_read("results")
                                                                              → receives research data
```

## What's Next (Phase 3A-4+)

Remaining Phase 3A items:
- **Orchestration patterns** — pre-built templates for sequential, parallel, hierarchical agent teams
- **Step-through debugging** — pause/inspect/approve agent actions
