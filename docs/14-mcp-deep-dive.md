# MCP in the Workbench — How, Where, Why, and Expansion

## What MCP Does for the Workbench

The Model Context Protocol is the bridge between Claude Code (the AI) and the workbench (the infrastructure). Without MCP, Claude Code could read files and run commands, but it couldn't search a knowledgebase, remember things across sessions, publish to a message bus, or step through agent actions. MCP gives Claude Code structured, typed access to workbench capabilities as tools it can reason about and call.

MCP matters because it turns infrastructure into **capabilities Claude can reason about**. The difference between "there's a Postgres database with embeddings" and "I have a `rag_query` tool that searches documentation" is the difference between infrastructure an engineer uses and a capability an AI uses.

## How MCP Works in Our Architecture

### The Transport: stdio

Claude Code runs the MCP bridge as a child process. Communication happens over stdin/stdout using JSON-RPC:

```
Claude Code process
  │
  ├── spawns: node /opt/mcp-bridge/index.js
  │             │
  │             ├── stdin:  Claude sends tool calls
  │             └── stdout: Bridge sends results
  │
  └── Claude's internal loop:
        1. User asks a question
        2. Claude decides which tool (if any) to call
        3. Claude writes tools/call to bridge's stdin
        4. Bridge translates to HTTP, calls Fastify API
        5. Bridge writes result to stdout
        6. Claude reads result, continues reasoning
```

### The Translation Layer: MCP Bridge

The bridge (`configs/mcp/bridge/index.js`) is a 300-line JavaScript file that does exactly one thing: translate between MCP's stdio protocol and the workbench's REST API. It has no business logic — every tool call becomes an HTTP request to the Fastify server.

```javascript
// Tool call comes in via MCP
case "rag_query":
  result = await api("/query", "POST", { question: args.question, top_k: args.top_k });
  break;

// api() adds the X-Project header and calls the Fastify server
async function api(path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (PROJECT) headers["X-Project"] = PROJECT;
  const res = await fetch(`${API}${path}`, { method, headers, body: JSON.stringify(body) });
  return res.json();
}
```

The bridge runs inside the `claude-code` Docker container. The Fastify API runs in the `mcp-server` container. They communicate over the Docker network.

### The API Layer: Fastify Server

The Fastify server is the real backend. It handles:
- Request validation (Zod schemas)
- Project resolution (which database to use)
- Service orchestration (embedding → search → LLM)
- Database operations (Postgres via postgres.js)
- Queue management (BullMQ)
- Redis operations (message bus, debug holds, memory)

MCP is one of several interfaces to this server. The same endpoints are accessible via curl, scripts, standalone agents, and future web UIs.

### The Schema Layer: Zod → JSON Schema

Every MCP tool definition comes from a Zod schema:

```typescript
// In schemas/rag.ts
export const QuerySchema = z.object({
  question: z.string().min(1).describe("The question to answer"),
  top_k: z.number().default(5).describe("Chunks to retrieve"),
});

// In schemas/index.ts
zodToJsonSchema(QuerySchema)
// → { type: "object", properties: { question: { type: "string", description: "..." }, ... } }
```

The `.describe()` calls on each field become the tool descriptions Claude reads when deciding how to use the tool. This is the same schema that validates HTTP requests — one definition, two uses.

## Where MCP Is Used (All 21 Tools)

### RAG Tools (5)

| Tool | API Endpoint | What Claude Uses It For |
|------|-------------|------------------------|
| `rag_ingest` | POST /ingest | Add documents to the knowledgebase |
| `rag_query` | POST /query | Search docs and get grounded answers |
| `rag_status` | GET /status | Check how many docs/chunks exist |
| `rag_reindex` | POST /reindex | Re-embed after model change |
| `rag_eval` | POST /eval | Measure search quality |

### Memory Tools (4)

| Tool | API Endpoint | What Claude Uses It For |
|------|-------------|------------------------|
| `agent_remember` | PUT /memory/:key | Store persistent state |
| `agent_recall` | GET /memory/:key | Retrieve stored state |
| `agent_forget` | DELETE /memory/:key | Remove a memory |
| `agent_memories` | GET /memory | List all stored keys |

### Conversation Tools (4)

| Tool | API Endpoint | What Claude Uses It For |
|------|-------------|------------------------|
| `conversation_create` | POST /conversations | Start a conversation thread |
| `conversation_list` | GET /conversations | See recent conversations |
| `conversation_get` | GET /conversations/:id | Read a conversation's messages |
| `conversation_append` | POST /conversations/:id/messages | Add messages to a thread |

### Message Bus Tools (3)

| Tool | API Endpoint | What Claude Uses It For |
|------|-------------|------------------------|
| `bus_publish` | POST /bus/publish | Send messages to agents |
| `bus_read` | POST /bus/read | Poll for agent responses |
| `bus_channels` | GET /bus/channels | See active communication channels |

### Development Tools (1)

| Tool | API Endpoint | What Claude Uses It For |
|------|-------------|------------------------|
| `project_test` | POST /test | Run the project's test suite |

### Debug Tools (4)

| Tool | API Endpoint | What Claude Uses It For |
|------|-------------|------------------------|
| `debug_enable` | POST /debug/mode | Turn step-through debugging on/off |
| `debug_pending` | GET /debug/pending | See actions waiting for approval |
| `debug_approve` | POST /debug/approve/:id | Let a pending action execute |
| `debug_reject` | POST /debug/reject/:id | Block a pending action |

## Why the Bridge-Over-HTTP Pattern

The MCP bridge could embed all the business logic directly — connect to Postgres, call OpenRouter, manage Redis. Instead, it's a thin HTTP translator. Why?

**Separation of concerns.** The bridge runs inside the `claude-code` container. If it had database connections, API keys, and service logic, the claude-code container would need all those dependencies. The bridge has zero dependencies beyond the MCP SDK and `fetch`.

**Multiple interfaces.** The Fastify API serves MCP (via bridge), curl (for scripts), standalone agents (Python clients), and future UIs. Business logic lives in one place.

**Debuggability.** You can `curl` any endpoint the bridge calls. If a tool fails, you reproduce the exact HTTP request outside of Claude Code. MCP stdio is harder to debug in isolation.

**Hot reload.** The bridge is plain JavaScript (no TypeScript compilation). Changes take effect on the next Claude Code session. The Fastify server compiles TypeScript, but the bridge doesn't need to.

## How to Expand MCP (Add a New Tool)

Adding a tool touches four files, always in the same order:

### Step 1: Schema (`src/schemas/*.ts`)

```typescript
// schemas/my-feature.ts
export const MyToolSchema = z.object({
  param: z.string().describe("What this parameter does"),
});
export type MyToolInput = z.infer<typeof MyToolSchema>;
```

Re-export from `schemas/index.ts`:
```typescript
export * from "./my-feature.js";
```

### Step 2: Service (`src/services/*.ts`)

```typescript
// services/my-feature.ts
export async function doMyThing(db: Db, param: string): Promise<string> {
  // Business logic here
  return result;
}
```

Takes `Db` as first parameter if it's project-scoped (database access needed). Pure function if it's not.

### Step 3: Route (`src/routes/*.ts`)

```typescript
// routes/my-feature.ts
app.post("/my-feature", async (request, reply) => {
  const db = request.projectDb;
  if (!db) return reply.status(400).send({ error: "No project context" });
  const parsed = MyToolSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
  return doMyThing(db, parsed.data.param);
});
```

Register in `routes/index.ts` inside `registerProjectScopedRoutes()`.

### Step 4: MCP Bridge (`configs/mcp/bridge/index.js`)

Tool definition (in the tools array):
```javascript
{
  name: "my_tool",
  description: "What this tool does — Claude reads this to decide when to use it",
  inputSchema: { type: "object", properties: { param: { type: "string" } }, required: ["param"] },
}
```

Tool handler (in the switch):
```javascript
case "my_tool":
  result = await api("/my-feature", "POST", { param: args.param });
  break;
```

### Optional: Slash Command

```markdown
<!-- configs/claude/commands/my-feature.md -->
Description of what this command does and how to use it.
Usage: /my-feature <param>
```

### The Pattern

Every tool follows the same flow:
```
Zod Schema → Service Function → Fastify Route → MCP Bridge Tool
   (types)     (logic)            (HTTP)           (Claude access)
```

This is mechanical. Adding a tool takes 10-20 minutes and touches no existing code (only adds new files and register calls).

## Why You'd Want More MCP Tools

### Domain-Specific Tools

If your project has domain-specific operations (generate invoices, run simulations, query a graph database), exposing them as MCP tools lets Claude operate on your domain directly. Instead of Claude writing a script that calls your API, Claude calls the tool — faster, safer, and it gets structured results.

### Workflow Automation

Tools for common workflows reduce the manual steps in your development cycle:
- `deploy_staging` — push the current build to staging
- `check_ci` — read CI/CD pipeline status
- `create_ticket` — file a bug in your issue tracker from a test failure
- `notify_team` — post a message to Slack with a summary

### External Service Integration

Connect Claude Code to external services your project depends on:
- `query_analytics` — pull metrics from Datadog/Grafana
- `check_logs` — search recent logs for errors
- `read_email` — scan for customer feedback related to a feature

Each of these follows the same four-step pattern: schema → service → route → bridge.

## MCP Beyond Claude Code

The MCP protocol isn't Claude Code-specific. Any MCP-compatible client can use the workbench tools:

- **Other AI IDEs** that support MCP (Cursor, Windsurf, etc.) can connect to the same bridge
- **Custom scripts** can use the MCP SDK to call tools programmatically
- **Web UIs** can use the REST API directly (same endpoints the bridge calls)

The workbench's tools are portable because the bridge is a thin translation layer. Swap the client, keep the tools.

## MCP Limitations in the Current Architecture

### No Streaming Results

MCP tool results are returned as complete objects. You can't stream partial results from a long-running tool call. This means a `/query` that takes 3 seconds returns nothing for 3 seconds, then the full result. For Claude Code this is acceptable (it processes results, not streams). For a chat UI, you'd want streaming via the REST API directly.

### No Push Notifications

The MCP server can't push data to Claude Code outside of a tool call response. If an agent finishes a task, the workbench can't notify Claude — it has to wait for Claude to poll. The message bus polling pattern works around this, but adds latency.

### No Resource Subscriptions (Yet)

MCP defines a `resources` capability for subscribing to data that changes over time. The workbench doesn't use this yet. Potential uses: subscribe to knowledgebase document count (refresh status automatically), subscribe to message bus channels (Claude sees new messages without polling).

### Single Transport

The bridge uses stdio only. MCP also supports HTTP+SSE transport, which would let remote clients connect to the workbench tools without spawning a subprocess. This would enable a web-based tool UI or remote Claude Code sessions.

## Files That Make Up the MCP Layer

| File | Role |
|------|------|
| `configs/mcp/bridge/index.js` | stdio ↔ HTTP bridge (21 tools, plain JS) |
| `configs/mcp/mcp-servers.json` | Declarative MCP server registration |
| `apps/mcp-server/src/mcp/index.ts` | TypeScript version of the bridge (compiled, reference) |
| `apps/mcp-server/src/schemas/index.ts` | `zodToJsonSchema()` converter for tool definitions |
| `apps/mcp-server/src/schemas/*.ts` | Per-feature schemas (rag, project, memory, bus, eval, export) |
| `apps/mcp-server/src/routes/index.ts` | Route registration (what endpoints exist) |
| `configs/claude/commands/*.md` | Slash commands (7 total) |
| `configs/claude/settings.json` | Claude Code permissions and hooks |
| `infra/scripts/register-mcp.sh` | Bootstrap script that registers the bridge with Claude Code |
