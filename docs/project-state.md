# AI Dev Workbench — Project State

**Last updated:** May 2026
**Status:** All planned phases complete. Agent eval framework delivered. Ready for production use.

## Build Summary

| Phase | Tests | Files | MCP Tools | What It Delivered |
|-------|-------|-------|-----------|-------------------|
| Phase 1 | 35 | 92 | 6 | Multi-project DB support, test runner, DI refactor, direct Postgres |
| Phase 2 | 59 | 111 | 14 | Conversations, agent memory, search eval, Grafana dashboards |
| Phase B | 74 | 133 | 14 | Scaffolding, import-vs-new detection, project templates, seed docs |
| Phase 3C | 79 | 145 | 14 | Export pipeline, auto-backup/restore, queue completion |
| Phase 3A-1 | 86 | 168 | 14 | Agent framework scaffolds (AutoGen, CrewAI, LangGraph, Custom) |
| Phase 3A-2 | 93 | 173 | 14 | OTel instrumentation, agent trace viewer dashboard |
| Phase 3A-3 | 107 | 179 | 17 | Multi-agent message bus (polling + SSE + pub/sub) |
| Phase 3A-4 | 107 | 189 | 17 | Orchestration patterns (sequential, parallel, hierarchical, consensus) |
| Phase 3A-5 | 113 | 193 | 21 | Step-through debugging (hold/approve/reject) |
| Agent Eval | 143 | 203 | 22 | Behavioral testing for agent decisions |

**Current totals:** 143 tests, 203 files, 22 MCP tools, 26 docs (8,300+ lines), 236KB package.

## Design & Programming Principles

### Domain-Driven Design (DDD)

The codebase is organized by domain, not by technical layer. Each feature has its own schema, service, route, and test files. Adding a new capability means adding files to each layer — not modifying a monolithic file.

```
Feature = Schema + Service + Route + Test + MCP Bridge entry

Example: Agent Memory
  schemas/memory.ts       ← data shapes and validation
  services/memory.ts      ← business logic (set, get, delete, list)
  routes/memory.ts        ← HTTP endpoints
  __tests__/…             ← tests per layer
  bridge/index.js         ← MCP tool definitions + handlers
```

Domains are: RAG (ingest, search, eval), Conversations, Memory, Message Bus, Debug, Agent Eval, Projects, Scaffold, Export, Lifecycle.

### Test-Driven Development (TDD)

Every phase ships with tests. Pure functions are tested in isolation without mocking. Service functions that need external dependencies (database, Redis, LLM APIs) are tested at the schema level and through integration tests.

Test hierarchy:
- `lib/*.ts` — pure functions, tested with direct unit tests (chunker, hash, templates, frameworks, eval-scoring, tracing attrs)
- `schemas/*.ts` — validation rules, tested with safeParse against valid and invalid inputs
- `services/*.ts` — business logic, tested via pure function extraction where possible
- `routes/*.ts` — HTTP layer, tested via the build (TypeScript compilation catches wiring errors)

The test runner is `vitest` with no globals, running only files matching `src/__tests__/**/*.test.ts`.

### Modular Architecture

Every source file does one thing. Services receive their database connection as a parameter (dependency injection), not from a global singleton. This means:
- Any service can be tested with a mock database
- Multi-project support works by passing different database connections
- Services don't know or care which project they're operating on

```typescript
// Services receive Db, not getDb()
export async function hybridSearch(db: Db, question: string, options: SearchOptions): Promise<QueryResult>
export async function ingestDocument(db: Db, filepath: string): Promise<IngestResult>
export async function memorySet(db: Db, key: string, value: unknown): Promise<MemoryEntry>
```

The route layer resolves the project and provides the database. The service layer operates on whatever database it receives.

### DRY (Don't Repeat Yourself)

Single source of truth patterns used throughout:

**Zod schemas** → generate TypeScript types, HTTP validation, MCP tool definitions, and documentation from ONE definition. No separate type files, no manual JSON Schema, no drift.

**Route registration** → `registerProjectScopedRoutes()` wires all project-scoped routes once, then is called at root level AND under `/p/:project` prefix. Two URL patterns, one set of route handlers.

**Template system** → base `_base/` templates are deep-merged with type-specific overrides. Shared defaults written once, types only override what's different.

**Redis factory** → `getRedis(name)` provides named, cached connections. Queue, bus, and debug services share the factory, not duplicate connection code.

**Eval scoring** → pure functions in `lib/eval-scoring.ts` are shared between `rag_eval` and `agent_eval`. Both use the same `eval_runs` table with namespace prefixes ("rag:" vs "agent:").

### Separation of Concerns

| Layer | Responsibility | Never Does |
|-------|---------------|------------|
| Schemas (`schemas/`) | Define data shapes, validate input | Business logic, database access |
| Services (`services/`) | Business logic, orchestration | HTTP handling, MCP protocol |
| Routes (`routes/`) | HTTP parsing, error responses | Business logic, database queries |
| Libs (`lib/`) | Pure utilities, no side effects | I/O, database, network calls |
| Middleware (`middleware/`) | Cross-cutting concerns (project resolution, tracing) | Business logic |
| MCP Bridge (`configs/mcp/bridge/`) | stdio ↔ HTTP translation | Business logic, validation |

### Infrastructure Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Language split | TS orchestration, Python ML | Zod/Fastify/MCP SDK are TS-native; embedding models are Python-native |
| Database per project | Multiple Postgres databases | Lifecycle independence: backup/drop/restore one project without touching others |
| Direct Postgres | postgres.js, not Supabase JS | Multi-database requires connection switching; PostgREST connects to one DB |
| Agent frameworks | Support all, embed none | Framework is a project dependency, not a workbench dependency |
| Import safety | Never overwrite existing files | CLAUDE.md, config files — workbench creates .workbench/ only, offers to append |
| MCP bridge | Thin HTTP translator | Business logic lives in Fastify; bridge has zero dependencies beyond fetch + MCP SDK |
| Tracing | OTel → Tempo → Grafana | Vendor-neutral, self-hosted, no SaaS dependency |
| Message bus | Redis lists + pub/sub | Lists for history (polling), pub/sub for real-time (SSE/direct) |

## Complete Feature Inventory

### MCP Tools (22)

```
RAG:           rag_ingest, rag_query, rag_status, rag_reindex, rag_eval
Memory:        agent_remember, agent_recall, agent_forget, agent_memories
Conversations: conversation_create, conversation_list, conversation_get, conversation_append
Message Bus:   bus_publish, bus_read, bus_channels
Debug:         debug_enable, debug_pending, debug_approve, debug_reject
Eval:          agent_eval
Development:   project_test
```

### REST API Endpoints

```
Health:        GET  /health
Projects:      GET  /projects, POST /projects, GET /projects/:name, DELETE /projects/:name
               PATCH /projects/:name/config, POST /projects/:name/export
               POST /projects/:name/backup, POST /projects/:name/restore
Scaffold:      POST /scaffold, POST /scaffold/append, GET /scaffold/seed-docs/:type
RAG:           POST /ingest, POST /query, GET /status, POST /reindex, POST /test
Conversations: POST /conversations, GET /conversations, GET /conversations/:id
               DELETE /conversations/:id, POST /conversations/:id/messages
Memory:        PUT /memory/:key, GET /memory/:key, DELETE /memory/:key, GET /memory
Eval:          POST /eval, GET /eval, POST /agent-eval, GET /agent-eval
Bus:           POST /bus/publish, POST /bus/read, GET /bus/channels
               DELETE /bus/:channel, GET /bus/:channel/stream
Debug:         POST /debug/mode, GET /debug/mode, GET /debug/pending
               POST /debug/approve/:id, POST /debug/reject/:id, POST /debug/approve-all
               POST /debug/hold
```

All project-scoped routes also available under `/p/:project/*`.

### Slash Commands (8)

```
/ingest <file>          — ingest a document
/query <question>       — search + answer
/status                 — knowledgebase stats
/reindex                — re-embed all docs
/test                   — run project test suite
/eval                   — search quality eval
/remember <key> <val>   — store persistent state
/recall <key>           — retrieve persistent state
/agent-eval             — behavioral agent testing
```

### Database Tables (per project)

```
documents          — source docs (title, hash, metadata)
document_chunks    — embedded chunks (vector + tsvector)
conversations      — multi-turn threads
messages           — conversation messages (user/assistant/system/tool)
memories           — key-value agent state
eval_runs          — search + agent eval history
```

### Project Templates (8 types)

```
fullstack       — web app (API + frontend + DB)
pwa             — progressive web app (service workers, offline)
cli             — command-line tool
rag             — knowledgebase-powered app
agent           — autonomous agent (with framework parameter)
multi-agent     — coordinated agent team (orchestration patterns)
data-pipeline   — ETL / data processing
custom          — all tools, no type-specific guidance
```

### Agent Framework Scaffolds (4)

```
autogen         — AG2 v0.4 (AssistantAgent, GroupChat)
crewai          — role-based crews (Agent, Task, Crew)
langgraph       — state graph (nodes, edges, ToolNode)
custom          — pure Anthropic SDK (no framework)
```

### Infrastructure

```
Docker Compose:  10 services (claude-code, mcp-server, rag-worker, supabase-db, supabase-rest,
                 supabase-kong, redis, otel-collector, tempo, grafana)
Terraform:       5 modules (networking, database, redis, containers, secrets)
                 2 environments (dev, prod)
Grafana:         2 auto-provisioned dashboards (workbench overview, agent trace viewer)
Migrations:      6 SQL files (extensions, documents, chunks, hybrid_search, conversations, memory+eval)
```

## Documentation Inventory (26 docs)

### Reference Docs
| Doc | Content |
|-----|---------|
| 01-grafana.md | Datasources, web UI, HTTP API, provisioning |
| 02-tempo.md | Trace storage architecture, config, WAL, blocks |
| 03-opentelemetry-collector.md | Receivers, processors, exporters, pipelines |
| 04-mcp-server-typescript-fastify-zod.md | Implementation details, Zod→JSON Schema, data flow |
| 05-mcp-api-orchestration.md | Orchestration patterns, service layer, error handling |
| 06-rag-knowledgebase-infrastructure.md | Full RAG pipeline, every component explained |
| 07-knowledgebase-common-uses.md | 6 use cases with patterns and code |
| 08-knowledgebase-build-applications.md | 6 buildable apps with architecture |
| 09-data-ingestion.md | File types, processing, storage, access patterns |
| 13-request-patterns.md | 6 request patterns, streaming analysis, gRPC assessment |
| 14-mcp-deep-dive.md | MCP architecture, all 22 tools, expansion guide |
| 15-agent-eval-framework.md | Behavioral testing design, scenario format, scoring |

### Architecture Docs
| Doc | Content |
|-----|---------|
| 10-multi-project-architecture.md | Multi-DB decision, lifecycle, portability |
| 11-project-types-and-affordances.md | 12 project types, affordance matrix, import-vs-new |
| 12-exporting-to-production.md | Export pipeline, 4 formats, what ships vs stays |
| design-note-four-skills.md | RAG/evals/agents/deployment gap analysis |

### Phase Reports
| Doc | Content |
|-----|---------|
| phase-1-report.md | Multi-project, test runner, DI refactor |
| phase-2-report.md | Conversations, memory, eval, dashboards |
| phase-b-report.md | Scaffolding, import, templates |
| phase-c-report.md | Export pipeline, loose ends |
| phase-3a1-report.md | Agent framework scaffolds |
| phase-3a2-report.md | OTel instrumentation, trace viewer |
| phase-3a3-report.md | Multi-agent message bus |
| phase-3a4-report.md | Orchestration patterns |
| phase-3a5-report.md | Step-through debugging |

### Operational
| Doc | Content |
|-----|---------|
| SMOKE-TEST.md | 18-phase validation guide |

## Options for Next Steps

### Deployment Completion (closes the "four skills" gaps)

| Item | Effort | Impact |
|------|--------|--------|
| Project deploy automation (`make deploy-project`) | ~200 lines | Wraps exported stack with build→push→migrate→update |
| CI/CD templates (GitHub Actions, GitLab CI) | ~200 lines | Automated testing and deployment on push |

### Scaffold Template Expansion

| Item | Effort | Impact |
|------|--------|--------|
| Fullstack starter code (Next.js or FastAPI) | ~150 lines | Real project structure, not just seed docs |
| PWA starter (service worker, manifest, offline shell) | ~100 lines | Working PWA from `make scaffold TYPE=pwa` |
| CLI starter (commander or click) | ~80 lines | Working CLI from `make scaffold TYPE=cli` |
| Mobile project type | ~100 lines | Scaffold for React Native or Flutter backend |

### Optimization

| Item | Effort | Impact |
|------|--------|--------|
| Streaming LLM responses | ~150 lines | Fast token display for chat UIs built on the workbench API |
| Queue completion via bus | ~20 lines | Eliminates polling for async ingestion status |
| Live mode for agent eval | ~100 lines | Eval calls real workbench APIs instead of mocks |
| MCP resource subscriptions | ~200 lines | Auto-refresh status in Claude Code |

### New Capabilities

| Item | Effort | Impact |
|------|--------|--------|
| GraphRAG integration (Neo4j) | ~500 lines | Entity-relationship search alongside vector search |
| Conversation-level evals | ~300 lines | Multi-turn behavioral tests with context carryover |
| Agent cost tracking | ~100 lines | Track LLM token usage and costs per project |
| Webhook notifications | ~100 lines | Push events to external URLs on job completion |
