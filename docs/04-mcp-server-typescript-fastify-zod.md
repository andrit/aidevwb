# MCP Server — TypeScript + Fastify + Zod Implementation

## What This Is

The MCP server is the **orchestration layer** of the workbench. It's written in TypeScript and uses three libraries that each own one concern:

- **Fastify** — HTTP framework. Handles routing, request/response lifecycle, logging, healthchecks.
- **Zod** — Schema validation. Defines the shape of every input and output. One schema generates types, validation, and MCP tool definitions.
- **MCP SDK** — Model Context Protocol. Exposes the workbench tools to Claude Code via a stdio bridge.

These three libraries were chosen over alternatives for specific reasons. This document explains each one, how they fit together, and how data flows through the system.

## Why TypeScript (Not Python, Not Plain JS)

The workbench has two language layers: TypeScript for orchestration, Python for ML/embedding work. The rationale:

**TypeScript owns orchestration because:**
- Zod schemas generate both runtime validation AND TypeScript types from a single definition. No drift between your types and your validators.
- Fastify's plugin architecture and async-first design handle concurrent requests well (embedding calls, database queries, LLM calls happen in parallel).
- The MCP SDK is TypeScript-native. The MCP protocol spec is defined in TypeScript. Writing the MCP server in TypeScript means zero impedance mismatch.
- BullMQ (the job queue) is TypeScript-native and deeply integrated with Redis.

**Python handles ML because:**
- RAG-Anything (multimodal document processing) is Python-only.
- Embedding model libraries, tokenizers, and ML tooling are Python-first.
- The Python layer is intentionally thin — individual scripts, not a framework.

## Fastify

### What Fastify Is

Fastify is a web framework for Node.js, similar to Express but with three key differences: it's significantly faster (benchmarks at 76k req/s vs Express's 15k), it has built-in JSON schema validation, and it has a proper plugin/encapsulation system.

In the workbench, Fastify handles:
- HTTP routing (`POST /ingest`, `POST /query`, `GET /status`, `GET /health`)
- Request validation (via Zod, not Fastify's built-in AJV)
- Structured logging (via Pino, Fastify's default logger)
- Health checks (Docker's healthcheck hits `GET /health`)

### Entry Point

**File:** `apps/mcp-server/src/index.ts`

```typescript
import Fastify from "fastify";
import { config } from "./config.js";
import { registerRoutes } from "./routes/index.js";

const app = Fastify({
  logger: {
    level: "info",
    transport: {
      target: "pino-pretty",       // Human-readable logs in dev
      options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
    },
  },
});

await registerRoutes(app);

await app.listen({ port: config.port, host: "0.0.0.0" });
```

Key decisions:
- `host: "0.0.0.0"` — binds to all interfaces so Docker can route traffic to the container.
- `pino-pretty` — formats log output for readability during development. In production, you'd remove the transport to get JSON logs (machine-parseable).

### Routes

**File:** `apps/mcp-server/src/routes/index.ts`

Each route follows the same pattern:
1. Parse request body with Zod
2. Call the relevant service
3. Return the result

```typescript
app.post("/ingest", async (request, reply) => {
  const parsed = IngestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.format() });
  }
  const result = await ingestDocument(parsed.data.filepath);
  return result;
});
```

Why `safeParse` instead of `parse`: `safeParse` returns a discriminated union (`{ success: true, data } | { success: false, error }`) instead of throwing. This gives explicit control over error responses rather than relying on exception handlers.

### Why Fastify Over Express

Express would work, but Fastify provides:
- **Type-safe route handlers** — Fastify's TypeScript generics for request/reply reduce `any` casts
- **Structured logging built-in** — Express requires manual logger setup
- **Plugin encapsulation** — each plugin gets its own scope, preventing accidental state leaks
- **Schema-based serialization** — Fastify can serialize responses faster using JSON Schema (we use Zod instead, but the option is there)

### Why Fastify Over Hono, Elysia, or Koa

- **Hono** — excellent, but its primary strength is edge/Cloudflare Workers. Fastify is more battle-tested for long-running server processes.
- **Elysia** — Bun-native, and the workbench runs on Node.js (for MCP SDK compatibility).
- **Koa** — minimalist like Express. Doesn't offer the validation/logging/plugin infrastructure Fastify provides out of the box.

## Zod

### What Zod Is

Zod is a TypeScript-first schema validation library. You define a schema once, and Zod gives you:
- **Runtime validation** — `schema.parse(data)` throws if data doesn't match
- **TypeScript types** — `z.infer<typeof schema>` extracts the type
- **JSON Schema conversion** — for MCP tool definitions, API docs, etc.

### The Single Source of Truth Pattern

**File:** `apps/mcp-server/src/schemas/index.ts`

This is the most important file in the MCP server. Every schema defined here flows through the entire system:

```typescript
import { z } from "zod";

export const QuerySchema = z.object({
  question: z.string().min(1).describe("The question to answer from the knowledgebase"),
  top_k: z.number().min(1).max(20).default(5).describe("Number of chunks to retrieve"),
});

// TypeScript type — inferred automatically, never manually written
export type QueryInput = z.infer<typeof QuerySchema>;
// Result: { question: string; top_k: number }
```

This one definition generates:

1. **Fastify validation** — `QuerySchema.safeParse(request.body)` in the route handler
2. **MCP tool definition** — `zodToJsonSchema(QuerySchema)` produces JSON Schema for Claude
3. **TypeScript type** — `QueryInput` is used in function signatures
4. **Documentation** — `.describe()` strings become field descriptions in the MCP tool

If you add a field, change a type, or update a description, it propagates everywhere automatically. There's no second file to update.

### The zodToJsonSchema Converter

**File:** `apps/mcp-server/src/schemas/index.ts` (bottom section)

The MCP protocol requires tool definitions in JSON Schema format. Zod schemas need to be converted:

```typescript
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as z.ZodType);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
  }
  // ... handles ZodString, ZodNumber, ZodBoolean, ZodDefault, ZodOptional
}
```

This recursive function walks the Zod schema tree and produces JSON Schema. The `.describe()` calls on each field become `description` properties in the output.

Example conversion:

```
Zod:
z.object({
  question: z.string().describe("The question"),
  top_k: z.number().default(5).describe("How many"),
})

JSON Schema:
{
  "type": "object",
  "properties": {
    "question": { "type": "string", "description": "The question" },
    "top_k": { "type": "number", "default": 5, "description": "How many" }
  },
  "required": ["question"]
}
```

### Why Zod Over Joi, Yup, or TypeBox

- **Joi** — runtime-only, no TypeScript type inference. You'd need to write types separately.
- **Yup** — similar to Joi. Less TypeScript-native.
- **TypeBox** — generates JSON Schema natively (good), but its API is more verbose and less ergonomic than Zod's chainable syntax.
- **Zod** — TypeScript-first, chainable API, `.describe()` for documentation, `.infer()` for types. The ecosystem standard for TypeScript validation.

### All Schemas in the Workbench

```typescript
// Ingest a document
IngestSchema:     { filepath: string }
IngestResultSchema: { status, document_id?, chunks?, content_hash?, reason?, job_id? }

// Query the knowledgebase
QuerySchema:      { question: string, top_k?: number (default 5) }
QueryResultSchema: { answer, sources[], search_method, embedding_model, llm_model }

// Knowledgebase status
StatusResultSchema: { total_documents, total_chunks, embedding_model, embedding_dimensions, queue_* }

// Reindex everything
ReindexSchema:    { confirm?: boolean (default false) }
```

## MCP SDK

### What MCP Is

The Model Context Protocol (MCP) is a standard for connecting AI models to external tools. When Claude Code calls a tool like `rag_query`, it's using MCP. The protocol defines:

- **Tool listing** — Claude asks "what tools do you have?" and receives JSON Schema definitions
- **Tool calling** — Claude sends a tool name + arguments, receives a result
- **Transport** — stdio (stdin/stdout pipes) or HTTP/SSE

### The MCP Bridge

**File:** `configs/mcp/bridge/index.js`

The MCP bridge is a thin stdio-to-HTTP proxy that runs inside the `claude-code` container. It translates MCP stdio calls into HTTP requests to the Fastify API:

```
Claude Code ←── stdio ──→ MCP Bridge ←── HTTP ──→ Fastify API
(inside claude-code)      (index.js)              (mcp-server:3100)
```

The bridge registers tools using JSON Schema (produced by `zodToJsonSchema`):

```javascript
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "rag_query",
      description: "Hybrid search the knowledgebase and generate an answer",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to answer" },
          top_k: { type: "number", description: "Number of chunks to retrieve", default: 5 },
        },
        required: ["question"],
      },
    },
    // ... other tools
  ],
}));
```

When Claude Code calls a tool:

```javascript
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  switch (name) {
    case "rag_query":
      result = await api("/query", "POST", {
        question: args.question,
        top_k: args.top_k || 5,
      });
      break;
    // ...
  }

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});
```

### Why stdio Transport (Not HTTP/SSE)

MCP supports two transports:
- **stdio** — communication via stdin/stdout pipes. The MCP server runs as a child process.
- **HTTP/SSE** — communication via HTTP requests and Server-Sent Events.

The workbench uses stdio because:
- Claude Code's `claude mcp add` command expects stdio-based servers
- stdio is simpler to debug (no port management, no CORS)
- The bridge is a child process of Claude Code, so lifecycle management is automatic

### Why a Bridge (Not Direct MCP)

The MCP server could run the Fastify API AND the MCP stdio server in the same process. The workbench separates them because:

1. **Different containers** — Claude Code runs in `claude-code`, the API runs in `mcp-server`. They can't share a process.
2. **The API is independently useful** — you can `curl` the API from the host, use it in CI/CD, or build a web frontend against it. MCP stdio can't do this.
3. **The bridge is zero-build** — plain JS, no TypeScript compilation. It works immediately without a build step in the `claude-code` container.

## Data Flow: A Complete Request

Here's what happens when you type `/query What is the default chunk size?` in Claude Code:

```
1. Claude Code reads /workspace/.claude/commands/query.md
   File: configs/claude/commands/query.md

2. Claude Code decides to call the rag_query MCP tool
   MCP bridge receives via stdio

3. Bridge POSTs to http://mcp-server:3100/query
   File: configs/mcp/bridge/index.js

4. Fastify route handler validates input via Zod
   File: apps/mcp-server/src/routes/index.ts
   Schema: apps/mcp-server/src/schemas/index.ts (QuerySchema)

5. hybridSearch() is called
   File: apps/mcp-server/src/services/search.ts

6. Question is embedded via OpenRouter
   File: apps/mcp-server/src/services/embeddings.ts
   API: https://openrouter.ai/api/v1/embeddings

7. Supabase RPC: hybrid_search(embedding, text, ...)
   File: supabase/migrations/004_hybrid_search.sql
   DB: supabase-db:5432

8. Claude generates answer from retrieved context
   File: apps/mcp-server/src/services/llm.ts
   API: Anthropic Messages API

9. Result flows back: service → route → HTTP → bridge → stdio → Claude Code
```

## Configuration

**File:** `apps/mcp-server/src/config.ts`

All configuration reads from environment variables with sensible defaults:

```typescript
export const config = {
  anthropicApiKey: env("ANTHROPIC_API_KEY"),           // Required
  claudeModel: env("CLAUDE_MODEL", "claude-sonnet-4-20250514"),  // Default
  openrouterApiKey: env("OPENROUTER_API_KEY"),         // Required
  embeddingModel: env("EMBEDDING_MODEL", "voyage/voyage-3"),
  embeddingDimensions: parseInt(env("EMBEDDING_DIMENSIONS", "1024")),
  supabaseUrl: env("SUPABASE_URL", "http://supabase-kong:8000"),
  supabaseServiceKey: env("SUPABASE_SERVICE_KEY"),     // Required
  redisUrl: env("REDIS_URL", "redis://redis:6379"),
  chunkSize: 500,      // Characters per chunk
  chunkOverlap: 50,    // Overlap between chunks
  vectorWeight: 0.7,   // Hybrid search: 70% semantic
  textWeight: 0.3,     // Hybrid search: 30% keyword
  matchThreshold: 0.5, // Minimum similarity score
  matchCount: 5,       // Default number of results
  port: parseInt(env("PORT", "3100")),
} as const;
```

The `as const` assertion makes every property `readonly` — config is immutable after startup.

## Walkthrough: Adding a New Tool

### Step 1 — Define the Zod schema

**File:** `apps/mcp-server/src/schemas/index.ts`

```typescript
export const SummarizeSchema = z.object({
  document_id: z.string().uuid().describe("UUID of the document to summarize"),
  max_length: z.number().default(500).describe("Maximum summary length in characters"),
});
export type SummarizeInput = z.infer<typeof SummarizeSchema>;
```

### Step 2 — Implement the service

**File:** `apps/mcp-server/src/services/summarize.ts` (new file)

```typescript
import { getSupabase } from "./supabase.js";
import { generateAnswer } from "./llm.js";

export async function summarizeDocument(documentId: string, maxLength: number): Promise<string> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("document_chunks")
    .select("content")
    .eq("document_id", documentId)
    .order("chunk_index");

  const fullText = data?.map(c => c.content).join("\n") || "";
  return generateAnswer(`Summarize in under ${maxLength} characters:\n\n${fullText}`, fullText);
}
```

### Step 3 — Add the route

**File:** `apps/mcp-server/src/routes/index.ts`

```typescript
app.post("/summarize", async (request, reply) => {
  const parsed = SummarizeSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.format() });
  }
  const result = await summarizeDocument(parsed.data.document_id, parsed.data.max_length);
  return { summary: result };
});
```

### Step 4 — Add to MCP bridge

**File:** `configs/mcp/bridge/index.js`

Add to the tools list:
```javascript
{
  name: "rag_summarize",
  description: "Summarize a specific document by its UUID",
  inputSchema: { /* from zodToJsonSchema(SummarizeSchema) */ },
}
```

Add to the switch:
```javascript
case "rag_summarize":
  result = await api("/summarize", "POST", { document_id: args.document_id, max_length: args.max_length });
  break;
```

### Step 5 — (Optional) Add slash command

**File:** `configs/claude/commands/summarize.md`

```
Summarize a document from the knowledgebase.
Usage: /summarize <document_id>
```

### Step 6 — Rebuild and test

```bash
docker compose build mcp-server
docker compose up -d mcp-server
curl -X POST http://localhost:3100/summarize \
  -H "Content-Type: application/json" \
  -d '{"document_id": "your-uuid-here"}'
```

## Files Referenced

| File | Purpose |
|------|---------|
| `apps/mcp-server/src/index.ts` | Fastify entry point, server startup |
| `apps/mcp-server/src/config.ts` | Centralized config from env vars |
| `apps/mcp-server/src/schemas/index.ts` | Zod schemas — single source of truth |
| `apps/mcp-server/src/routes/index.ts` | HTTP route handlers |
| `apps/mcp-server/src/services/embeddings.ts` | OpenRouter embedding client |
| `apps/mcp-server/src/services/llm.ts` | Anthropic Claude client |
| `apps/mcp-server/src/services/search.ts` | Hybrid search orchestration |
| `apps/mcp-server/src/services/ingest.ts` | Document ingestion + SHA256 dedup |
| `apps/mcp-server/src/services/queue.ts` | BullMQ job queue for async work |
| `apps/mcp-server/src/services/supabase.ts` | Supabase client singleton |
| `apps/mcp-server/src/mcp/index.ts` | MCP stdio server (TS version, used in build) |
| `configs/mcp/bridge/index.js` | MCP stdio bridge (plain JS, runs in claude-code) |
| `apps/mcp-server/package.json` | Dependencies |
| `apps/mcp-server/tsconfig.json` | TypeScript compiler config |
| `apps/mcp-server/Dockerfile` | Multi-stage build: compile TS → production Node image |
