# Phase 3A-2 Report — Agent Trace Viewer

## What Was Built

Phase 3A-2 adds OpenTelemetry instrumentation to the MCP server and an agent-focused Grafana dashboard. Every RAG query, embedding call, LLM generation, memory operation, and HTTP request now produces distributed traces visible in Grafana.

Three deliverables:

1. **OTel SDK integration** — tracing library with initialization, span helpers, and attribute factories
2. **Service instrumentation** — embeddings, LLM, and search services wrapped in traced spans with domain-specific attributes
3. **Agent Trace Viewer dashboard** — Grafana dashboard showing agent decision chains, tool call patterns, memory operations, LLM performance, and errors

## Why Instrumentation Matters for Agent Development

Agents are hard to debug because their behavior emerges from a loop of decisions. An agent calls a tool, reads the result, decides what to do next, calls another tool — and if something goes wrong, you need to see the full chain to understand why.

Without traces, you're reading logs line by line. With traces, you see the full decision tree: the RAG query took 2.3s (800ms embedding, 400ms search, 1.1s LLM), the agent called `rag_query` three times before answering, the second call returned zero results which caused the agent to change strategy.

The trace viewer makes this visual and navigable in Grafana.

## Architecture

```
Service Code                    OTel SDK                    Pipeline
────────────                    ────────                    ────────

embedTexts()                    
  └── withSpan("embedding.batch")
        └── span attributes:     ─── BatchSpanProcessor ──▸ OTLP HTTP
              embedding.model                                   │
              embedding.input_count                             ▼
              embedding.dimensions                    OTel Collector (:4318)
              embedding.total_tokens                            │
                                                                ▼
hybridSearch()                                           Tempo (storage)
  ├── withSpan("rag.hybrid_search")                             │
  │     └── search.top_k, search.results, search.top_score      ▼
  ├── embedSingle() → child span                    Grafana Agent Trace Viewer
  ├── withSpan("db.hybrid_search")                     (:3200/d/agent-traces)
  │     └── db.result_count
  └── generateAnswer() → child span

generateAnswer()
  └── withSpan("llm.generate_answer")
        └── llm.model, llm.input_tokens, llm.output_tokens

HTTP Requests (Fastify hooks)
  └── auto-span per request
        └── http.method, http.url, http.status_code,
            http.response_time_ms, workbench.project
```

## Tracing Library (`lib/tracing.ts`)

### `initTracing()`

Call once at server startup. Reads `OTEL_EXPORTER_OTLP_ENDPOINT` from environment. If not set, tracing is disabled (no-op). If set, configures the NodeTracerProvider with a BatchSpanProcessor that exports to the OTLP HTTP endpoint.

### `withSpan(name, attributes, fn)`

The core helper. Wraps any async function in a traced span:

```typescript
const result = await withSpan(
  "embedding.batch",
  spanAttrs.embedding("voyage/voyage-3", 10),
  async (span) => {
    // do work — this is traced
    span.setAttribute("embedding.dimensions", 1024);
    return embeddings;
  }
);
```

The span is:
- Started before the function runs
- Attributed with the initial attribute set
- Ended after the function completes
- Marked ERROR with exception recorded if it throws
- Nested under the active parent span (if one exists)

Services call `withSpan()` instead of importing OTel directly. This keeps OTel as an implementation detail of the tracing library.

### `spanAttrs` Factories

Consistent attribute naming across all services:

```typescript
spanAttrs.rag(project, operation)         → workbench.project, workbench.operation, workbench.category=rag
spanAttrs.embedding(model, count)         → embedding.model, embedding.input_count, workbench.category=embedding
spanAttrs.llm(model, operation)           → llm.model, llm.operation, workbench.category=llm
spanAttrs.agentTool(project, toolName)    → workbench.project, agent.tool, workbench.category=agent
spanAttrs.memory(project, operation, key) → workbench.project, memory.operation, memory.key, workbench.category=memory
spanAttrs.conversation(project, op)       → workbench.project, conversation.operation, workbench.category=conversation
```

The `workbench.category` attribute on every span enables filtering in Grafana by category (rag, embedding, llm, agent, memory, conversation).

## Service Instrumentation

### Embeddings (`services/embeddings.ts`)

`embedTexts()` is wrapped in `withSpan("embedding.batch")`. Records:
- `embedding.model` — which model (e.g., "voyage/voyage-3")
- `embedding.input_count` — how many texts in the batch
- `embedding.dimensions` — output vector dimensions
- `embedding.total_tokens` — tokens consumed (for cost tracking)

### LLM (`services/llm.ts`)

`generateAnswer()` and `summarizeForIngestion()` are wrapped in `withSpan("llm.generate_answer")` and `withSpan("llm.summarize")`. Records:
- `llm.model` — Claude model used
- `llm.question_length` / `llm.input_length` — input size
- `llm.context_length` — context window size
- `llm.input_tokens`, `llm.output_tokens` — token usage
- `llm.stop_reason` — why generation stopped

### Search (`services/search.ts`)

`hybridSearch()` creates a parent span `rag.hybrid_search` with two child spans:
- `embedding.batch` (child, via `embedSingle`) — embedding the query
- `db.hybrid_search` (child, explicit) — PostgreSQL hybrid search function

Records on the parent: `search.top_k`, `search.results`, `search.top_score`, `search.answer_length`.

This means a single `/query` request produces a trace tree:

```
POST /query (HTTP request span)
  └── rag.hybrid_search (search orchestration)
        ├── embedding.batch (embed the question)
        ├── db.hybrid_search (PostgreSQL query)
        └── llm.generate_answer (Claude API call)
```

### HTTP Requests (`middleware/tracing.ts`)

Fastify hooks create a root span per request with:
- `http.method`, `http.url`, `http.route`
- `http.status_code`, `http.response_time_ms`
- `workbench.project` (from header/param/env)

## Grafana Dashboard: Agent Trace Viewer

Auto-provisioned at `http://localhost:3200` under the "AI Dev Workbench" folder. Six panels:

| Panel | What it shows |
|-------|--------------|
| Agent Operations Timeline | Table of recent traces — click any row to see the full span tree |
| Operation Latency — RAG Pipeline | Bar chart of `rag.hybrid_search` durations — shows where time is spent |
| Agent Tool Calls | Table filtered by `workbench.category=agent` — which tools, how often |
| Memory Operations | Table filtered by `workbench.category=memory` — which keys, read vs write |
| LLM Call Performance | Table filtered by `workbench.category=llm` — token usage, latency |
| Error Traces | Table filtered by `status=error` — failed operations with error details |

### Using the Dashboard

1. Open Grafana at `http://localhost:3200`
2. Navigate to Dashboards → AI Dev Workbench → Agent Trace Viewer
3. Set the time range (default: last 30 minutes)
4. Click any trace in the Operations Timeline to see the full span tree
5. In the span tree, click a span to see its attributes (token counts, scores, keys)

### What You're Looking For

**Agent debugging:** Click a trace for a `/query` call. The span tree shows: HTTP request → hybrid search → embedding (how long?) → DB search (how many results? top score?) → LLM generation (how many tokens?). If the answer was wrong, check `search.top_score` — low score means retrieval failed, not the LLM.

**Performance tuning:** The RAG Pipeline Latency panel shows the time breakdown. If embedding is slow, consider a cheaper model. If DB search is slow, check index health. If LLM is slow, check context length.

**Memory tracking:** The Memory Operations panel shows which keys agents are reading and writing. Use this to understand what state the agent is building across sessions.

**Error investigation:** The Error Traces panel catches API timeouts, database connection failures, and embedding errors. Click a trace to see the exception.

## Files Created

| File | Purpose |
|------|---------|
| `src/lib/tracing.ts` | OTel initialization, `withSpan()`, `spanAttrs` factories |
| `src/middleware/tracing.ts` | Fastify request tracing hooks |
| `src/__tests__/lib/tracing.test.ts` | 7 tests for spanAttrs factories |
| `configs/grafana/dashboards/json/agent-traces.json` | Agent Trace Viewer dashboard |

## Files Modified

| File | Change |
|------|--------|
| `src/index.ts` | `initTracing()` on startup, `registerTracingHooks()` before routes |
| `src/services/embeddings.ts` | `withSpan("embedding.batch")` wrapping embed calls |
| `src/services/llm.ts` | `withSpan("llm.generate_answer")` + `withSpan("llm.summarize")` wrapping Claude calls |
| `src/services/search.ts` | Parent `withSpan("rag.hybrid_search")` + child `withSpan("db.hybrid_search")` |
| `package.json` | Added 5 OTel dependencies |

## Test Results

```
 ✓ src/__tests__/schemas/schemas.test.ts (19 tests)
 ✓ src/__tests__/lib/chunker.test.ts (11 tests)
 ✓ src/__tests__/schemas/phase2-schemas.test.ts (20 tests)
 ✓ src/__tests__/lib/tracing.test.ts (7 tests)
 ✓ src/__tests__/schemas/export.test.ts (5 tests)
 ✓ src/__tests__/lib/templates.test.ts (15 tests)
 ✓ src/__tests__/lib/frameworks.test.ts (7 tests)
 ✓ src/__tests__/lib/hash.test.ts (5 tests)
 ✓ src/__tests__/services/conversations.test.ts (4 tests)

 Test Files  9 passed (9)
      Tests  93 passed (93)
```

## What's Next (Phase 3A-3+)

Remaining Phase 3A items:
- **Multi-agent message bus** — Redis pub/sub with MCP tools for inter-agent communication
- **Orchestration patterns** — pre-built templates for sequential, parallel, hierarchical agent teams
- **Step-through debugging** — pause/inspect/approve agent actions
