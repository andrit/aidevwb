# Request Patterns — How Data Moves Through the Workbench

## The Five Request Patterns We Use

The workbench uses five distinct request patterns. Each one exists because of a specific constraint — the consumer's capabilities, the operation's duration, or the data flow direction.

### Pattern 1: Synchronous Request-Response (REST)

**Where:** every Fastify HTTP endpoint (`POST /query`, `POST /ingest`, `GET /status`, etc.)

**How:** client sends a request, server processes it, server returns a response. The connection is held open for the entire duration. The client blocks until the response arrives.

```
Client ──── POST /query ────▸ Server
                                │
                          embed question
                          search database
                          call Claude LLM
                                │
Client ◂── 200 JSON ─────── Server
```

**Why this pattern:** it's the simplest pattern and covers the majority of operations. For requests that complete in under 30 seconds (most queries, status checks, memory operations, conversation CRUD), synchronous is the right choice. The overhead of async patterns (queuing, polling, callbacks) isn't justified.

**Limitation:** long-running operations (PDF ingestion, reindex) can't use this pattern — the HTTP connection would timeout. Those use Pattern 2.

### Pattern 2: Async Queue (BullMQ + Redis)

**Where:** multimodal file ingestion (`POST /ingest` for PDFs, images), reindex operations

**How:** the API receives the request, enqueues a job in Redis via BullMQ, and returns immediately with a `status: queued` response. A Python worker process polls the queue, processes the job, and stores results in the database. The client checks progress via `/status` (queue depth) or queries the knowledgebase.

```
Client ──── POST /ingest (PDF) ────▸ API Server
                                        │
                                   enqueue job → Redis (BullMQ)
                                        │
Client ◂── 200 {status: "queued"} ── API Server

                                   ... minutes later ...

                                   Worker ◂── poll ── Redis
                                        │
                                   process PDF
                                   embed chunks
                                   store in Postgres
```

**Why this pattern:** PDF processing takes 30 seconds to 5 minutes. Holding an HTTP connection open that long is fragile (timeouts, disconnects, resource waste). The queue decouples submission from processing.

**Limitation:** no built-in notification when the job completes. The client has to poll `/status` or check the knowledgebase. A webhook callback or WebSocket notification would close this gap (see "Potential Improvements" below).

### Pattern 3: MCP stdio (Tool Calls)

**Where:** Claude Code ↔ MCP Bridge (`configs/mcp/bridge/index.js`)

**How:** Claude Code spawns the MCP bridge as a subprocess. They communicate via stdin/stdout using the MCP protocol (JSON-RPC over stdio). When Claude decides to use a tool, it sends a `tools/call` request on stdout. The bridge reads it, makes an HTTP request to the Fastify API, gets the response, and writes it back on stdout.

```
Claude Code ──── tools/call {name: "rag_query", args: {...}} ──── stdin ───▸ MCP Bridge
                                                                                │
                                                                         HTTP POST /query
                                                                                │
                                                                           API Server
                                                                                │
Claude Code ◂── {content: [{type: "text", text: "..."}]} ──── stdout ──── MCP Bridge
```

**Why this pattern:** Claude Code's `claude mcp add` expects stdio-based servers. This is the MCP spec's primary transport for local tools. The bridge is a thin translator — stdio on one side, HTTP on the other.

**Limitation:** stdio is inherently request-response. Claude Code sends a tool call, waits for the result, then continues. There's no mechanism for the tool to push data to Claude Code outside of a tool call response. This is why the message bus uses polling (Pattern 4) instead of streaming for Claude Code.

### Pattern 4: Polling with Cursor (Message Bus)

**Where:** `bus_read(channel, since_id)` MCP tool, `POST /bus/read` REST endpoint

**How:** the client sends a read request with a `since_id` cursor — the ID of the last message it saw. The server returns all messages with ID > since_id. The client processes them and stores the latest ID for the next poll.

```
Client ──── bus_read(channel="planning", since_id=0) ───▸ Server
Client ◂── messages [1, 2, 3] ────────────────────────── Server

... time passes, new messages arrive ...

Client ──── bus_read(channel="planning", since_id=3) ───▸ Server
Client ◂── messages [4, 5] ──────────────────────────── Server
```

**Why this pattern:** MCP tools (Pattern 3) are request-response. Claude Code can't hold an open subscription. Polling with a cursor is the only way to get incremental updates through a request-response interface. The `since_id` cursor ensures no messages are missed and no duplicates are returned.

**Limitation:** latency is proportional to poll interval. If Claude Code polls every turn (every ~5-30 seconds), messages are delivered with that delay. For real-time applications, this is too slow — which is why standalone agents use Pattern 5.

### Pattern 5: Server-Sent Events (SSE Streaming)

**Where:** `GET /bus/:channel/stream` REST endpoint, used by standalone agents

**How:** the client opens an HTTP connection with `Accept: text/event-stream`. The server holds the connection open and pushes messages as they arrive, using the SSE format (`data: {...}\n\n`). The connection stays open indefinitely until the client disconnects.

```
Client ──── GET /bus/planning/stream ────▸ Server
Client ◂── : connected                ──── Server (keepalive)

... agent publishes a message ...

Client ◂── data: {"id":1,"sender":"researcher","content":"..."}\n\n ── Server

... another message ...

Client ◂── data: {"id":2,"sender":"writer","content":"..."}\n\n ── Server
```

Backed by Redis pub/sub internally: the SSE endpoint subscribes to a Redis pub/sub channel. When a message is published (via `busPublish()`), Redis delivers it to the subscriber, which writes it to the SSE stream.

**Why this pattern:** standalone agents (AutoGen, CrewAI, LangGraph, custom Python) run their own event loops and can hold open connections. SSE delivers messages instantly (~milliseconds) without polling overhead. It uses plain HTTP (no WebSocket upgrade needed), works through proxies, and the client implementation is trivial (`httpx.stream()` in Python, `EventSource` in JavaScript).

**Limitation:** SSE is server→client only. The client can't send messages back over the same connection. For bidirectional communication, agents publish via `POST /bus/publish` (Pattern 1) and receive via SSE (Pattern 5).

### Pattern 6: Redis Pub/Sub (Direct)

**Where:** `busSubscribe()` in the bus service, used by agents with direct Redis access

**How:** the agent opens a Redis connection in subscriber mode. It subscribes to a channel. When a message is published, Redis pushes it to all subscribers instantly.

```
Agent A ──── SUBSCRIBE bus:pubsub:nexus:planning ───▸ Redis
Agent B ──── PUBLISH bus:pubsub:nexus:planning {...} ──▸ Redis
Agent A ◂── message: {...} ──────────────────────────── Redis
```

**Why this pattern:** lowest possible latency. No HTTP overhead, no serialization/deserialization on the transport layer (Redis handles it). Used by agents that already have a Redis client (ioredis in Node, redis-py in Python).

**Limitation:** requires a Redis client dependency. The agent's code is coupled to Redis. For portability, most agents should use SSE (Pattern 5) instead — it's nearly as fast and works over standard HTTP.

## Where Each Pattern Is Used

```
Consumer              Pattern              Use Cases
────────              ───────              ─────────
Claude Code           stdio (MCP)          All 21 MCP tools
Claude Code           polling              bus_read, debug_pending
curl / scripts        REST                 All API endpoints
Standalone agents     REST                 publish, query, memory, debug hold
Standalone agents     SSE                  bus streaming (real-time receive)
Standalone agents     Redis pub/sub        bus streaming (lowest latency)
rag-worker            Queue (BullMQ)       PDF/image ingestion
MCP bridge            REST (internal)      Bridge → API server
```

## Potential Improvements

### gRPC Instead of REST (Between Services)

**Where it would help:** MCP bridge → API server, and potentially rag-worker → API server.

**The gain:** gRPC uses Protocol Buffers (binary serialization) over HTTP/2 with multiplexed streams. Compared to REST (JSON over HTTP/1.1):
- ~10× smaller payloads for structured data (Protobuf vs JSON)
- Connection multiplexing (multiple requests over one TCP connection)
- Bidirectional streaming (server and client can push simultaneously)
- Generated client/server stubs (no manual HTTP client code)

**Where it wouldn't help:** the bottleneck in the workbench isn't serialization or HTTP overhead — it's embedding API latency (~500ms), LLM API latency (~1-3s), and database query time (~50-200ms). gRPC would shave milliseconds off each hop, but the total request time is dominated by external API calls. The complexity of Protobuf schemas, code generation, and a gRPC server alongside Fastify isn't justified for the current scale.

**When to consider it:** if the workbench scales to serve multiple concurrent users (team scenario) or processes high volumes of requests (automated pipeline), the connection multiplexing and binary serialization would matter. For single-user local development, REST is simpler and fast enough.

### WebSocket for Bidirectional Agent Communication

**Where it would help:** replacing the SSE + REST publish pattern with a single bidirectional WebSocket per agent.

**The gain:** currently, agents receive messages via SSE (server→client) and publish via REST POST (client→server). A WebSocket would collapse both directions into one persistent connection:

```
Current:  Agent ──POST──▸ Server (publish)
          Agent ◂──SSE─── Server (receive)

WebSocket: Agent ◂──────▸ Server (both directions)
```

This eliminates the HTTP overhead per publish (connection setup, headers) and lets the server push acknowledgments, errors, and coordination signals in real-time.

**Where it wouldn't help:** Claude Code still can't use WebSockets (MCP is stdio-based, turn-by-turn). The polling pattern for Claude Code is an MCP constraint, not a transport choice. WebSocket would only benefit standalone agents.

**When to consider it:** when multi-agent systems are chatty — many small messages per second between agents. For occasional coordination messages (orchestration patterns publish a few messages per step), SSE + REST POST is adequate.

### Streaming LLM Responses

**Where it would help:** `POST /query` and any endpoint that calls the Claude API.

**The gain:** currently, the `/query` endpoint waits for the entire Claude response to complete before sending it to the client. With streaming, the server would start sending tokens as they arrive:

```
Current:  Client ── POST /query ──▸ wait 3 seconds ──▸ full response
Streaming: Client ── POST /query ──▸ tokens arrive in ~100ms ──▸ incrementally
```

The Anthropic SDK supports streaming (`client.messages.stream()`). The server would use SSE or chunked transfer encoding to push tokens to the client.

**What would change:**
- `services/llm.ts` — switch from `client.messages.create()` to `client.messages.stream()`
- `routes/rag.ts` — the `/query` endpoint would need a streaming response mode (SSE or chunked)
- The MCP bridge can't stream (MCP tool responses are complete objects) — so this only benefits direct REST clients
- The search flow becomes: embed → search → start streaming LLM → client sees tokens arriving while generation continues

**When to consider it:** when building a user-facing chat interface on top of the workbench API. A 3-second wait for a response feels slow; seeing tokens appear in 100ms feels fast. For Claude Code (which processes tool results, not streams), streaming doesn't help.

### Queue Job Completion Callbacks

**Where it would help:** PDF ingestion — currently the client has no way to know when a queued job finishes except by polling `/status`.

**The gain:** when a queued job completes, the worker could:
1. Publish a completion message on the message bus (`bus:publish("jobs", "worker", {status: "done", job_id: "..."})`)
2. Call a webhook URL provided by the client
3. Update a job status table that the client can query by job ID

Option 1 (bus publish) is nearly free — the infrastructure already exists. An agent or script that ingests a PDF could subscribe to the `jobs` channel and get notified the instant processing completes, instead of polling `/status` every 5 seconds.

**Effort:** ~20 lines in the rag-worker — publish a message when the job completes.

### HTTP/2 Server Push

**Where it would help:** Grafana dashboard data freshness. Currently Grafana polls Tempo on a refresh interval.

**The gain:** minimal for this use case. Grafana handles its own refresh cycle and Tempo doesn't support push. Not worth pursuing.

## Summary: Current State and Next Steps

The current pattern mix is well-matched to the consumers:

| Consumer | Needs | Pattern | Adequate? |
|----------|-------|---------|-----------|
| Claude Code | Tool call results | MCP stdio | ✅ Yes (MCP constraint) |
| Claude Code | Bus messages | Polling | ✅ Acceptable (MCP constraint) |
| Standalone agents | Real-time messages | SSE | ✅ Yes |
| Standalone agents | Publish + tool calls | REST | ✅ Yes |
| rag-worker | Long jobs | BullMQ queue | ✅ Yes |
| Users (future UI) | Fast responses | REST | ⚠️ Would benefit from streaming |

The two most impactful improvements are:
1. **Streaming LLM responses** — matters when building a chat UI on the workbench API
2. **Queue completion via bus** — trivial to add, eliminates polling for async ingestion

gRPC and WebSocket are justified at scale but add complexity that isn't needed for single-user local development.
