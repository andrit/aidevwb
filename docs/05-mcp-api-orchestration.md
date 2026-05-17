# MCP Server & API Orchestration — General Concepts

## What an Orchestration Layer Is

An orchestration layer is the service that **coordinates work between other services** without doing the heavy lifting itself. It receives a request, decides which services to call, in what order, gathers results, and returns a unified response.

In the workbench, the MCP server is the orchestrator. When you ask "What is the refund policy?", the orchestrator:
1. Calls the embedding service (OpenRouter) to vectorize your question
2. Calls the database (Supabase) to find similar document chunks
3. Calls the LLM (Claude) to generate an answer from the retrieved chunks
4. Assembles the response with the answer, sources, and metadata

The orchestrator doesn't embed text, doesn't store vectors, and doesn't generate language. It coordinates the services that do.

## Why Separate Orchestration from Execution

You could put everything in one monolithic service. The orchestration pattern separates them because:

**Independent scaling** — the embedding service is CPU-bound, the LLM call is IO-bound (waiting on an API), and the database query is memory-bound. Mixing them means you can't scale one without scaling all.

**Independent failure** — if the embedding API is down, you can still serve cached queries. If the LLM is slow, you can still ingest documents. A monolith couples all failure modes.

**Independent deployment** — change the embedding model without touching the LLM code. Swap the database without changing the API routes.

**Testability** — you can test the orchestrator with mocked services. You can test each service in isolation.

## The Model Context Protocol (MCP)

### What MCP Is

MCP is an open protocol (created by Anthropic) that standardizes how AI models interact with external tools and data sources. It defines a communication contract:

1. **Tool Discovery** — the AI asks "what tools do you have?" and gets a list with JSON Schema definitions
2. **Tool Invocation** — the AI sends a tool name + validated arguments
3. **Result Delivery** — the tool returns structured content (text, images, or resources)

MCP is transport-agnostic. It works over:
- **stdio** — stdin/stdout pipes (used in the workbench for Claude Code)
- **HTTP + SSE** — HTTP requests with Server-Sent Events for streaming

### How MCP Relates to Function Calling

If you've used OpenAI's function calling or Anthropic's tool use, MCP is the next layer up. Function calling is built into the LLM API — you define tools in your API call, and the model calls them. MCP externalizes this: tools are defined by a separate server, and the AI client (Claude Code, in our case) discovers them dynamically.

The benefit: your tools are defined once, and any MCP-compatible client can use them. If a new AI IDE supports MCP, your workbench tools work there without changes.

### MCP Server Lifecycle

```
1. Client (Claude Code) starts the MCP server as a subprocess
   → claude mcp add workbench -- node /opt/mcp-bridge/index.js

2. Client sends: "tools/list" request via stdin
   ← Server responds with tool definitions via stdout

3. User types a prompt. Claude decides to use a tool.
   Client sends: "tools/call" with {name: "rag_query", arguments: {question: "..."}}
   ← Server executes the tool and responds with the result

4. Claude incorporates the result and responds to the user.

5. Repeat 3-4 until the session ends.

6. Client kills the subprocess.
```

### MCP vs REST API

The workbench exposes both MCP (for Claude Code) and REST (for everything else). They hit the same backend:

```
Claude Code ──── MCP stdio ──── Bridge ──── HTTP ──── Fastify
curl/browser ────────────────────────────── HTTP ──── Fastify
CI/CD pipeline ──────────────────────────── HTTP ──── Fastify
Web frontend ────────────────────────────── HTTP ──── Fastify
```

MCP is the interface for AI tools. REST is the interface for everything else. Both are first-class.

## API Orchestration Patterns

### Pattern 1: Synchronous Orchestration

The orchestrator calls services sequentially and waits for each result:

```
Request → Embed Question → Search DB → Call LLM → Response
                ↓                ↓           ↓
           OpenRouter       Supabase      Claude
```

Used for: `/query` — the answer depends on the search results, which depend on the embedding.

### Pattern 2: Asynchronous Orchestration

The orchestrator enqueues work and returns immediately:

```
Request → Check Hash → Enqueue Job → Response (status: queued)
                            ↓
                     Redis (BullMQ)
                            ↓
                     Worker picks up job
                            ↓
                     Process document
                            ↓
                     Store in database
```

Used for: `/ingest` with multimodal files — PDF processing takes seconds to minutes, too long to hold an HTTP connection.

### Pattern 3: Inline + Queue Hybrid

The orchestrator decides at runtime whether to process inline or queue:

```
Request → Read file → Check extension
              ↓
         .txt/.md → Inline: chunk + embed + store → Response (status: ingested)
         .pdf/.png → Queue: enqueue to BullMQ → Response (status: queued)
```

Used for: `/ingest` — text files are fast enough to process inline, multimodal files are queued.

This is implemented in `apps/mcp-server/src/services/ingest.ts`:

```typescript
const MULTIMODAL_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ...]);

export async function ingestDocument(filepath: string): Promise<IngestResult> {
  const ext = extname(filepath).toLowerCase();

  if (MULTIMODAL_EXTENSIONS.has(ext)) {
    const jobId = await enqueueIngest(filepath);  // Queue path
    return { status: "queued", job_id: jobId };
  }

  return ingestTextFile(filepath);  // Inline path
}
```

### Pattern 4: Fan-Out / Fan-In

The orchestrator calls multiple services in parallel and combines results:

```
Request → ┬── Service A ──┐
          ├── Service B ──┤── Combine → Response
          └── Service C ──┘
```

Not currently used in the workbench, but the infrastructure supports it. Example use case: querying both the vector knowledgebase AND a graph database (Neo4j) in parallel, then merging results.

## The Service Layer

### Architecture

```
apps/mcp-server/src/
├── index.ts              ← Entry point (Fastify startup)
├── config.ts             ← Environment → typed config object
├── schemas/
│   └── index.ts          ← Zod schemas (single source of truth)
├── routes/
│   └── index.ts          ← HTTP route handlers
├── services/
│   ├── supabase.ts       ← Database client (singleton)
│   ├── embeddings.ts     ← OpenRouter embedding client
│   ├── llm.ts            ← Anthropic Claude client
│   ├── search.ts         ← Hybrid search orchestration
│   ├── ingest.ts         ← Document ingestion + SHA256 dedup
│   └── queue.ts          ← BullMQ job queue
└── mcp/
    └── index.ts          ← MCP stdio server (TS compiled version)
```

### Service Responsibilities

Each service file does exactly one thing:

| Service | Responsibility | External Dependency |
|---------|---------------|-------------------|
| `supabase.ts` | Database client singleton | Supabase (PostgreSQL) |
| `embeddings.ts` | Convert text to vectors | OpenRouter API |
| `llm.ts` | Generate text answers | Anthropic API |
| `search.ts` | Orchestrate hybrid search | supabase + embeddings + llm |
| `ingest.ts` | Document processing pipeline | supabase + embeddings + queue |
| `queue.ts` | Async job management | Redis (BullMQ) |

`search.ts` and `ingest.ts` are **orchestrating services** — they coordinate other services. The rest are **leaf services** — they talk to one external dependency.

### Dependency Direction

```
routes/index.ts
    ↓
search.ts / ingest.ts  (orchestrating services)
    ↓
embeddings.ts / llm.ts / supabase.ts / queue.ts  (leaf services)
    ↓
External APIs / Databases
```

Dependencies flow downward. Leaf services never import orchestrating services. Routes never import leaf services directly (they go through orchestrators). This prevents circular dependencies and keeps the code testable.

## Error Handling Philosophy

The workbench uses **explicit error returns** instead of exceptions for expected failures:

```typescript
// IngestResult is a discriminated union
type IngestResult =
  | { status: "ingested"; document_id: string; chunks: number; content_hash: string }
  | { status: "skipped"; reason: string; document_id: string; content_hash: string }
  | { status: "queued"; reason: string; job_id: string }
  | { status: "error"; reason: string }
```

Unexpected errors (network failures, crashes) still throw and are caught by Fastify's error handler. But expected failures (file not found, duplicate document) return structured results that Claude can reason about.

This matters because Claude Code reads tool results. A structured `{ status: "skipped", reason: "unchanged (SHA256 match)" }` is more useful to Claude than a generic error message.

## Walkthrough: Tracing a Request End-to-End

### Step 1 — Start the stack

```bash
make up
```

### Step 2 — Send a query and watch the logs

Terminal 1:
```bash
make logs-mcp
```

Terminal 2:
```bash
curl -s -X POST http://localhost:3100/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the chunk size?"}' | python3 -m json.tool
```

### Step 3 — Read the log output

The MCP server logs each step:
```
14:32:01 INFO  incoming request: POST /query
14:32:01 INFO  embedding question via OpenRouter (voyage/voyage-3)
14:32:02 INFO  hybrid_search RPC: 3 chunks found
14:32:02 INFO  generating answer via Claude (claude-sonnet-4-20250514)
14:32:04 INFO  request completed: 200 (2847ms)
```

### Step 4 — Check the response structure

```json
{
  "answer": "The default chunk size is 500 characters...",
  "sources": [
    {
      "chunk_id": "abc-123",
      "document_id": "def-456",
      "similarity": 0.8234,
      "text_rank": 0.0412,
      "hybrid_score": 0.5887
    }
  ],
  "search_method": "hybrid",
  "embedding_model": "voyage/voyage-3",
  "llm_model": "claude-sonnet-4-20250514"
}
```

The response tells you exactly what happened: which search method was used, which models produced the results, and the confidence scores for each source.

## Files Referenced

| File | Purpose |
|------|---------|
| `apps/mcp-server/src/index.ts` | Fastify startup, server config |
| `apps/mcp-server/src/config.ts` | Centralized env var → typed config |
| `apps/mcp-server/src/schemas/index.ts` | All Zod schemas |
| `apps/mcp-server/src/routes/index.ts` | HTTP handlers |
| `apps/mcp-server/src/services/*.ts` | All service modules |
| `apps/mcp-server/src/mcp/index.ts` | MCP stdio server (TS) |
| `configs/mcp/bridge/index.js` | MCP bridge (plain JS, in claude-code) |
| `configs/mcp/mcp-servers.json` | Declarative MCP server registry |
| `configs/claude/commands/*.md` | Slash command definitions |
| `configs/claude/settings.json` | Claude Code permissions and hooks |
