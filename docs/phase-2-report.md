# Phase 2 Report — AI-Native Affordances

## What Was Built

Phase 2 adds four capabilities that transform the workbench from a development environment with optional RAG into a platform for building AI-native applications:

1. **Conversation history** — multi-turn context store for chatbot and agent projects
2. **Agent memory** — persistent key-value state across sessions
3. **Search quality eval** — measure and track retrieval quality with test query sets
4. **Grafana dashboards** — auto-provisioned visual feedback for RAG operations

## Why These Capabilities

### Conversation history (the context problem)

The Phase 1 workbench was stateless per query — each `/query` call was independent. This is fine for documentation lookup but blocks building anything conversational. A chatbot needs to know what the user said three messages ago. An agent needs to track its plan across steps.

The conversation store provides this: create a conversation, append messages with roles (user/assistant/system/tool), retrieve history, feed it into the LLM as context. Each conversation is a thread with ordered messages and timestamps.

This isn't a chatbot framework — it's a storage primitive. The framework (if any) lives in your project. The workbench provides the plumbing.

### Agent memory (the state problem)

RAG stores unstructured text and finds it via semantic search. But agents also need structured state: "the user's name is Alice," "we're on step 3 of 5," "the API key for staging is X." This is key-value data, not search-and-retrieve.

`agent_remember("user:name", "Alice")` stores it. `agent_recall("user:name")` gets it back exactly. No embedding, no similarity scoring — just exact key lookup. Values are arbitrary JSON (strings, objects, arrays, numbers).

Keys are namespaced with colons for organization: `user:*`, `agent:*`, `project:*`, `decisions:*`. The `agent_memories` tool lists keys by prefix.

### Search quality eval (the measurement problem)

In Phase 1, you could ingest documents and query them, but you had no way to know if the results were good. Are the right chunks being retrieved? Is the embedding model appropriate for your domain? Do your chunk sizes make sense?

The eval system runs a defined set of test queries, scores each one, and computes aggregate metrics:

- **Pass rate** — percentage of queries where the top result exceeds a minimum score
- **MRR (Mean Reciprocal Rank)** — how high the best relevant result ranks on average. 1.0 means the best answer is always the top result. 0.5 means it's typically second.
- **Keyword coverage** — do the retrieved chunks contain expected keywords?
- **Expected document match** — is the right source document in the results?

Eval runs are stored in the database for historical comparison. Run an eval, change the embedding model, reindex, run the eval again, compare scores.

### Grafana dashboards (the visibility problem)

Phase 1 set up the observability pipeline (OTel → Tempo → Grafana) but shipped no dashboards. Now there's an auto-provisioned "Workbench Overview" dashboard with:

- Recent traces from the MCP server (what operations are happening)
- Trace duration distribution (how fast are requests)
- RAG worker traces (background ingestion activity)

The dashboard is provisioned via file — it exists on first boot with no manual setup.

## Database Changes

Two new migrations added to every project database:

**005_conversations.sql:**
```sql
conversations (id, title, metadata, created_at, updated_at)
messages (id, conversation_id, role, content, metadata, created_at)
```

**006_memory_eval.sql:**
```sql
memories (key PRIMARY KEY, value jsonb, metadata, created_at, updated_at)
eval_runs (id, query_set_name, results jsonb, summary jsonb, created_at)
```

Existing projects need these migrations applied. The `runMigrations()` function handles this idempotently — running against an existing database skips tables that already exist.

## Files Created

### Schemas

| File | Purpose |
|------|---------|
| `src/schemas/conversation.ts` | Conversation + message schemas, create/append inputs |
| `src/schemas/memory.ts` | Memory key/value schemas, set/get/list inputs |
| `src/schemas/eval.ts` | Eval query set, run input, query result, run result |

### Services

| File | Purpose |
|------|---------|
| `src/services/conversations.ts` | CRUD for conversations + messages, context formatting |
| `src/services/memory.ts` | Key-value set/get/delete/list with JSONB storage |
| `src/services/eval.ts` | Run eval queries, compute MRR/pass rate, store results |

### Routes

| File | Purpose |
|------|---------|
| `src/routes/conversations.ts` | REST endpoints for conversation management |
| `src/routes/memory.ts` | REST endpoints for memory CRUD |
| `src/routes/eval.ts` | REST endpoints for running and listing evals |

### Tests

| File | Tests |
|------|-------|
| `src/__tests__/schemas/phase2-schemas.test.ts` | 20 tests — conversation, memory, eval schema validation |
| `src/__tests__/services/conversations.test.ts` | 4 tests — formatConversationContext pure function |

### Slash Commands

| File | Tool |
|------|------|
| `configs/claude/commands/eval.md` | `/eval` — run search quality evaluation |
| `configs/claude/commands/remember.md` | `/remember` — store a key-value pair |
| `configs/claude/commands/recall.md` | `/recall` — retrieve or list memories |

### Infrastructure

| File | Purpose |
|------|---------|
| `supabase/migrations/005_conversations.sql` | Conversations + messages tables |
| `supabase/migrations/006_memory_eval.sql` | Memories + eval_runs tables |
| `configs/grafana/dashboards/provider.yml` | Dashboard auto-provisioning config |
| `configs/grafana/dashboards/json/workbench-overview.json` | Workbench overview dashboard |

### Modified Files

| File | Change |
|------|--------|
| `src/schemas/index.ts` | Re-exports conversation, memory, eval schemas |
| `src/routes/index.ts` | Registers conversation, memory, eval routes; DRY via `registerProjectScopedRoutes()` |
| `src/services/projects.ts` | Migration list includes 005 + 006 |
| `configs/mcp/bridge/index.js` | 8 new MCP tools added |
| `docker-compose.yml` | Grafana dashboard volume mounts |

## Test Results

```
 ✓ src/__tests__/schemas/phase2-schemas.test.ts (20 tests)
 ✓ src/__tests__/schemas/schemas.test.ts (19 tests)
 ✓ src/__tests__/lib/chunker.test.ts (11 tests)
 ✓ src/__tests__/lib/hash.test.ts (5 tests)
 ✓ src/__tests__/services/conversations.test.ts (4 tests)

 Test Files  5 passed (5)
      Tests  59 passed (59)
```

## User Interfaces

### MCP Tools (14 total, 8 new)

```
Phase 1 tools:
  rag_ingest          — ingest documents
  rag_query           — hybrid search + answer
  rag_status          — knowledgebase stats
  rag_reindex         — re-embed everything
  project_test        — run test suite

Phase 2 tools (NEW):
  agent_remember      — store key-value in persistent memory
  agent_recall        — retrieve a value by key
  agent_forget        — delete a key from memory
  agent_memories      — list all keys (optional prefix filter)
  conversation_create — start a new conversation thread
  conversation_list   — list recent conversations
  conversation_get    — get conversation with all messages
  conversation_append — add messages to a conversation
  rag_eval            — run search quality evaluation
```

### REST API (new endpoints)

**Conversations (project-scoped):**

```bash
# Create a conversation
POST /conversations
{"title": "Debug session", "messages": [{"role": "user", "content": "Hello"}]}

# List conversations
GET /conversations?limit=20&offset=0

# Get conversation with messages
GET /conversations/:id

# Append messages
POST /conversations/:id/messages
{"messages": [{"role": "assistant", "content": "How can I help?"}]}

# Delete conversation
DELETE /conversations/:id
```

**Agent Memory (project-scoped):**

```bash
# Store a value
PUT /memory/user:name
{"value": "Alice"}

# Retrieve a value
GET /memory/user:name

# List all keys
GET /memory

# List keys by prefix
GET /memory?prefix=agent:

# Delete a key
DELETE /memory/user:name
```

**Search Eval (project-scoped):**

```bash
# Run an eval
POST /eval
{
  "name": "baseline-v1",
  "queries": [
    {"question": "What is the refund policy?", "expected_keywords": ["refund", "30 days"]},
    {"question": "How do I reset my password?", "expected_keywords": ["password", "reset"]}
  ],
  "top_k": 5
}

# Response:
{
  "name": "baseline-v1",
  "total_queries": 2,
  "passed": 2,
  "failed": 0,
  "avg_top_score": 0.7832,
  "mrr": 1.0,
  "results": [...]
}

# List historical eval runs
GET /eval?limit=10
```

### Slash Commands (3 new)

```
/eval                              — run search quality evaluation
/remember user:name Alice          — store in persistent memory
/recall user:name                  — retrieve from memory
/recall agent:                     — list all agent: keys
/recall                            — list all memory keys
```

### Grafana Dashboard

Auto-provisioned at [http://localhost:3200](http://localhost:3200) under the "AI Dev Workbench" folder. Shows trace tables and duration distributions from the MCP server and RAG worker. Refreshes every 30 seconds.

## Architecture After Phase 2

```
MCP Tools (14)
├── RAG:    ingest, query, status, reindex, eval
├── Memory: remember, recall, forget, memories
├── Conv:   create, list, get, append
└── Dev:    test

REST API
├── /health                        — always available
├── /projects/*                    — project management
├── /ingest, /query, /status, ...  — RAG operations
├── /conversations/*               — conversation history
├── /memory/*                      — agent key-value store
├── /eval                          — search quality eval
├── /test                          — test runner
└── /p/:project/*                  — explicit project scope

Project Database Tables
├── documents           — source documents (Phase 1)
├── document_chunks     — embedded chunks (Phase 1)
├── conversations       — conversation threads (Phase 2)
├── messages            — conversation messages (Phase 2)
├── memories            — agent key-value state (Phase 2)
└── eval_runs           — search quality history (Phase 2)
```

## What's Next (Phase 3)

Phase 3 adds advanced agent development affordances:
- Agent scaffold templates (`make scaffold TYPE=agent FRAMEWORK=autogen`)
- Agent trace viewer (Grafana dashboard for decision chains)
- Multi-agent message bus (Redis pub/sub)
- Orchestration patterns (sequential, parallel, hierarchical)
- Step-through debugging
