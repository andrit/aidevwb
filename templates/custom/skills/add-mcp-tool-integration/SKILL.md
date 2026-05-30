---
name: add-mcp-tool-integration
description: Integrate an MCP tool from the workbench into a custom project — wire agent_remember for cross-session memory, rag_query for semantic search, bus_publish/bus_read for event coordination, or project_test for CI
domain: custom
type: custom
triggers:
  - "add MCP tool"
  - "use agent_remember"
  - "use rag_query"
  - "use bus_publish"
  - "wire up MCP"
  - "MCP integration"
  - "use project_test"
  - "add memory to my project"
  - "search my documents"
  - "publish an event"
---

# Add MCP Tool Integration

## When to use

When a custom project needs one or more workbench MCP tools beyond the baseline (`rag_ingest`, `rag_query`, `project_test`). The full list of 22 tools is available to custom projects — this skill covers how to wire up the most commonly needed ones and test that they're working. Activate when the user says "I want Claude Code to remember things across sessions", "I want to search my project docs", "I need to coordinate between components with events", or "how do I run tests from the workbench."

## Prerequisites

- Project registered and `WORKBENCH_PROJECT` set in `.env`
- Workbench services running (`make up`)
- `CLAUDE.md` exists (see `setup-project-structure`)

## Available MCP Tools by Category

```
RAG (knowledge):  rag_ingest, rag_query, rag_status, rag_reindex, rag_eval
Memory:           agent_remember, agent_recall, agent_forget, agent_memories
Conversations:    conversation_create, conversation_list, conversation_get, conversation_append
Message bus:      bus_publish, bus_read, bus_channels
Debug:            debug_enable, debug_pending, debug_approve, debug_reject
Eval:             agent_eval
Dev:              project_test
```

## Integration 1 — Memory: `agent_remember` / `agent_recall`

Use for: persisting decisions, user preferences, project state, or any information that should survive across Claude Code sessions.

**In Claude Code (slash commands the user types):**
```bash
/remember decisions:auth "We chose JWT over sessions because mobile clients can't use cookies"
/recall decisions:auth
```

**In project code (calling the workbench API directly):**
```typescript
// src/lib/workbench.ts
const WORKBENCH_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3001";
const PROJECT = process.env.WORKBENCH_PROJECT!;

export async function remember(key: string, value: string): Promise<void> {
  await fetch(`${WORKBENCH_URL}/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: PROJECT, key, value }),
  });
}

export async function recall(key: string): Promise<string | null> {
  const res = await fetch(`${WORKBENCH_URL}/memory/${PROJECT}/${encodeURIComponent(key)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.value ?? null;
}
```

**Good use cases:**
- `agent_remember` key=`config:api-version` value=`v2` — remember which API version we're targeting
- `agent_remember` key=`user:timezone` value=`America/New_York` — remember user preferences
- `agent_remember` key=`decisions:db-schema` value=`...` — remember design decisions made mid-session

**Key namespace conventions:**
```
decisions:<topic>   — architectural decisions
user:<preference>   — user preferences
config:<setting>    — configuration values
state:<component>   — current state of something
```

## Integration 2 — Knowledge: `rag_query` / `rag_ingest`

Use for: making project documentation, specs, and reference material searchable by Claude Code.

**Ingest documents:**
```bash
# From the workbench claude-code terminal:
/ingest docs/api-spec.md
/ingest docs/data-model.md
/ingest https://docs.example.com/reference   # URL ingestion

# Verify:
/status
```

**Query in Claude Code conversations:**
```bash
/query "how does the authentication flow work"
/query "what are the error codes for the payment API"
```

**Query from project code:**
```typescript
export async function queryKnowledge(question: string): Promise<string> {
  const res = await fetch(`${WORKBENCH_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: PROJECT, query: question }),
  });
  const data = await res.json();
  return data.answer;
}

// Usage: lookup domain rules without hardcoding them
const rule = await queryKnowledge("what is the maximum refund period for subscription cancellations");
```

**What to ingest for a custom project:**
```
✓ Design documents and RFCs
✓ API reference documentation
✓ Domain glossary (your GLOSSARY.md from the ubiquitous-language skill)
✓ Architecture decision records (ADRs)
✓ External API docs you integrate with
✗ Source code — Claude Code already reads source files directly
✗ Generated files (dist/, build/) — noise without signal
```

## Integration 3 — Events: `bus_publish` / `bus_read`

Use for: coordinating between independent components of a custom project, or between the project and other workbench services.

**Publish an event:**
```bash
# In a Claude Code conversation:
# (use when you want to notify another component about something that happened)
```

**In project code:**
```typescript
export async function publishEvent(channel: string, payload: unknown): Promise<void> {
  await fetch(`${WORKBENCH_URL}/bus/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, message: payload }),
  });
}

export async function readEvents(
  channel: string,
  group: string,
  count = 10
): Promise<unknown[]> {
  const res = await fetch(
    `${WORKBENCH_URL}/bus/read?channel=${channel}&group=${group}&count=${count}`
  );
  const data = await res.json();
  return data.messages ?? [];
}

// Example: a scraper publishes discovered items; a processor reads and acts on them
await publishEvent("scraper.items-found", { items: [...], source: "web", foundAt: new Date() });

// Processor side:
const events = await readEvents("scraper.items-found", "item-processor");
for (const event of events) {
  await processItem(event.items);
}
```

**Channel naming for custom projects:**
```
<project-name>.<event-name>   — scoped to your project
e.g.:  my-tool.job-completed
       my-tool.error-occurred
       my-tool.user-action
```

## Integration 4 — Testing: `project_test`

Use for: running your project's test suite from within a Claude Code conversation without leaving the terminal.

**Configure the test command:**
```json
// .workbench/config.json
{
  "name": "my-project",
  "type": "custom",
  "testCommand": "npm test"
}
```

**Then in Claude Code:**
```bash
/test
# Runs: npm test (or whatever testCommand is set to)
# Output is shown in the conversation
```

**Test command examples:**
```json
{ "testCommand": "npm test" }              // Node.js
{ "testCommand": "pytest -x" }             // Python, stop on first failure
{ "testCommand": "cargo test" }            // Rust
{ "testCommand": "go test ./..." }         // Go
{ "testCommand": "make test" }             // Makefile target
{ "testCommand": "npx vitest run" }        // Vitest
```

## Integration 5 — Conversations: `conversation_create` / `conversation_append`

Use for: building a project that itself has multi-turn conversations with users — a chatbot, an assistant, an interactive tool.

```typescript
export async function createConversation(userId: string): Promise<string> {
  const res = await fetch(`${WORKBENCH_URL}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: PROJECT, metadata: { userId } }),
  });
  const data = await res.json();
  return data.id;
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  await fetch(`${WORKBENCH_URL}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, content }),
  });
}

export async function getHistory(conversationId: string): Promise<Message[]> {
  const res = await fetch(`${WORKBENCH_URL}/conversations/${conversationId}`);
  const data = await res.json();
  return data.messages ?? [];
}
```

## Verifying Tool Integration

```bash
# Verify the MCP bridge is working and tools are registered
cd configs/mcp/bridge
timeout 3 node -e "import('./index.js').then(() => console.log('OK')); setTimeout(() => process.exit(0), 2000)"

# Check project is registered and tools are active
make list-projects

# Test RAG is working:
/ingest docs/test.md
/status  # should show 1+ documents
/query "test query"

# Test memory:
/remember test:key "hello"
/recall test:key  # should return "hello"
```

## Checklist

- [ ] `WORKBENCH_PROJECT` set in `.env` and matches the registered project name
- [ ] `MCP_SERVER_URL` set in `.env` (default: `http://mcp-server:3001` inside Docker, `http://localhost:3001` outside)
- [ ] For RAG: at least one document ingested; `/status` shows it; `/query` returns results
- [ ] For memory: `/remember test:key val` → `/recall test:key` round-trip works
- [ ] For bus: `publishEvent` + `readEvents` tested with a throw-away channel
- [ ] For testing: `testCommand` set in `.workbench/config.json`; `/test` runs and shows output
- [ ] MCP bridge verified: `timeout 3 node -e "import('./index.js')..."` outputs "OK"

## Files involved

| File | Action |
|------|--------|
| `.workbench/config.json` | Update: add `testCommand` |
| `src/lib/workbench.ts` | Create (optional): typed wrappers for workbench API calls |
| `CLAUDE.md` | Update: document which MCP tools are in use and what for |
| `.env` | Update: ensure `WORKBENCH_PROJECT` and `MCP_SERVER_URL` are set |

## Common mistakes

**`WORKBENCH_PROJECT` not set** — every MCP tool call fails silently or returns empty results. The project name in `.env` must exactly match the name used in `make project NAME=x`.

**Calling the MCP API from outside Docker without updating `MCP_SERVER_URL`** — inside the Docker network, use `http://mcp-server:3001`. From the host machine or from a process running outside Docker, use `http://localhost:3001`. The wrong URL causes silent connection failures.

**Ingesting source code into RAG** — RAG is for unstructured documents that Claude Code can't read directly (PDFs, large reference docs, external API specs). Source files in your repo are better read with the Read tool. Ingesting `.ts` files creates a noisy, low-value index.

**Not updating `CLAUDE.md` with tool usage** — if you add `agent_remember` to the project, document in `CLAUDE.md` which keys are used and what they mean. Without this, future sessions won't know what's in memory or why.
