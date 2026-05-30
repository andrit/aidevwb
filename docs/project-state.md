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
| Microservices + Docs | 155 | 214 | 22 | Microservices project type (5 orchestrators), project types explainer, request patterns doc, MCP deep dive, developing-vs-utilizing doc |
| Embedding Fix + IoT | 155 | 249 | 22 | Ollama local embeddings (default, no API key), IoT/ROS2 project type (project.json, 4 seed docs, 8 skills), docs updated |
| Capability Registry API | 166 | 251 | 22 | `GET /capabilities` + `GET /capabilities/:token` routes, `CapabilityProvider` Zod schema, `groupByCapability` pure helper, shape-mismatch fix (plain string tokens in JSONB array), 11 new tests |

**Current totals:** 166 tests, 251 files, 22 MCP tools, 30 docs (9,800+ lines), ~420KB package.

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
Capabilities:  GET  /capabilities, GET /capabilities/:token
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

### Project Templates (9 types)

```
fullstack       — web app (API + frontend + DB)
pwa             — progressive web app (service workers, offline)
cli             — command-line tool
rag             — knowledgebase-powered app
agent           — autonomous agent (with framework parameter)
multi-agent     — coordinated agent team (orchestration patterns)
data-pipeline   — ETL / data processing
iot             — IoT/ROS2 (ROS2 nodes, MQTT sensors, robot controllers, edge deployment)
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
Docker Compose:  11 services (claude-code, mcp-server, rag-worker, postgres, redis,
                 otel-collector, tempo, grafana, ollama, + neo4j optional profile)
Terraform:       5 modules (networking, database, redis, containers, secrets)
                 2 environments (dev, prod)
Grafana:         2 auto-provisioned dashboards (workbench overview, agent trace viewer)
Migrations:      6 SQL files (extensions, documents, chunks, hybrid_search, conversations, memory+eval)
Ollama:          Local embedding service — mxbai-embed-large (1024 dims), no API key needed
```

## Documentation Inventory (29 docs)

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
| 16-project-types-explainer.md | DDD definition of project types, full taxonomy, decision flowchart |
| 17-zero-trust-agent-architecture.md | Zero Trust AI agent architecture — 5 layers, workbench gap analysis, 4 proposed skills |
| 18-production-readiness-analysis.md | Production readiness gaps for all 9 project types — 10 dimensions, 16 proposed new skills, build order |
| 19-iot-ros2-project-type-plan.md | IoT/ROS2 project type design plan — 8 skills, 4 seed docs, build order, open questions (IMPLEMENTED: templates/iot/) |
| 20-embedding-provider-issue.md | Blocked RAG ingestion — voyage/voyage-3 missing from OpenRouter, account has no credits. Two resolution options, file path note. |
| 21-elixir-channel-project-type-composition.md | Elixir-inspired composition model for project types — provides/consumes schema, capability substitutability, coordinator options, open questions. |
| 22-programming-skills-hierarchy.md | Hierarchy and categories for 28 cross-cutting programming/infra/platform/animation skills — tiers, filesystem layout, project type affinity, build status. |
| 23-design-principles-guide.md | Modularity, DRY, SOLID, and category theory as applied to the workbench — source-of-truth map, composition model diagram, anti-patterns, file-level contracts, decision guide. |

### Architecture Docs
| Doc | Content |
|-----|---------|
| 10-multi-project-architecture.md | Multi-DB decision, lifecycle, portability |
| 11-project-types-and-affordances.md | 12 project types, affordance matrix, import-vs-new |
| 12-exporting-to-production.md | Export pipeline, 4 formats, what ships vs stays |
| design-note-four-skills.md | RAG/evals/agents/deployment gap analysis |
| developing-vs-utilizing-workbench.md | Mode A vs Mode B, startup guide, switching projects |

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
| project-state.md | This file — full inventory, decisions, skills build plan |

## DEFERRED: Blocking Issues

These must be resolved before certain workbench features are usable.

### Embedding Provider — RESOLVED (May 2026)

**Was:** `voyage/voyage-3` via OpenRouter — model didn't exist, account had no credits.

**Fix applied:** Ollama now runs as a first-class Docker service (`ollama/ollama:latest`). Both `mcp-server` and `rag-worker` default to `http://ollama:11434/v1` with `mxbai-embed-large` (1024 dims). No API key or cloud account required. Voyage AI and OpenRouter remain drop-in alternatives via env vars.

**Verified working:** `POST /ingest` returns `{"status":"skipped","reason":"unchanged (SHA256 match)"}` — embedding pipeline confirmed functional.

See `docs/20-embedding-provider-issue.md` for the full resolution and provider switching guide.

**Remaining file path note:** mcp-server only mounts `./documents/`. Files must be copied there before ingesting, or mount `./docs` as a second volume.

### Potential Bug — Context Bloat / Task Stall During Ingest — RESOLVED (No Bug)

**Investigated:** May 2026

Grepped both `apps/mcp-server/src/` and `apps/rag-worker/lib/worker.py` for any call to `/models` or model-list endpoint. **No such call exists.** Both embedding clients (`embeddings.ts` and `worker.py`) create a single OpenAI-compatible client at module load time and only call `embeddings.create()` — never `models.list()` or any model-validation endpoint. The task stall was caused by something else (likely network timeout or large context, not a code-level bug). No fix needed.

---

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
| Mobile project type | ✅ DONE | `templates/mobile/` — project.json, React Native skill, Swift/Kotlin/ReactVR referenced from _base |

### Project Type Flexibility

| Item | Effort | What it does |
|------|--------|--------------|
| `make add-capability NAME=x CAPABILITY=y` | ~80 lines | Deep-merges a second project type config onto an existing project without touching any files |
| `_base/skills/INDEX.md` + catalog wiring | ~60 lines | Skills discovery so Claude infers the right skill from natural language |

#### `make add-capability` — Implementation Sketch

The command deep-merges a second type's `project.json` onto an existing registered project. It is additive and non-destructive: never overwrites files, never removes existing MCP tools or skills.

```
make add-capability NAME=myapp CAPABILITY=pwa
make add-capability NAME=myapp CAPABILITY=rag
make add-capability NAME=myapp CAPABILITY=mobile
```

**Implementation — three parts:**

**1. Shell script `infra/scripts/add-capability.sh`**
```bash
NAME=$1 CAPABILITY=$2
# Read current project config
CURRENT=$(curl -s http://localhost:3200/projects/$NAME)
# Read capability template
TEMPLATE=$(cat templates/$CAPABILITY/project.json)
# Deep-merge and PATCH
node -e "
  const current = $CURRENT.config ?? {};
  const tmpl    = $TEMPLATE;
  const merged  = deepMerge(current, tmpl, { arrays: 'union' });
  merged.type   = current.type;  // never change the primary type
  merged.capabilities = [...(current.capabilities ?? []), '$CAPABILITY'];
  fetch('http://localhost:3200/projects/$NAME', {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ config: merged })
  });
"
```

**2. `deepMerge` with `arrays: 'union'` semantics**
- Scalars: keep current value (don't override `type`, `description`)
- Objects: recurse
- Arrays: union (append new items, deduplicate by value) — so MCP tools and skills never lose entries

**3. Makefile target**
```makefile
add-capability:
	@test -n "$(NAME)" || (echo "NAME required"; exit 1)
	@test -n "$(CAPABILITY)" || (echo "CAPABILITY required"; exit 1)
	@test -d templates/$(CAPABILITY) || (echo "Unknown capability: $(CAPABILITY)"; exit 1)
	bash infra/scripts/add-capability.sh $(NAME) $(CAPABILITY)
```

**What it changes in the project's stored config:**
- `mcp_tools` — union with capability's tools
- `skills` — union with capability's skills
- `capabilities[]` — appends the new capability name (for the composition model)
- `roadmap` — appends capability-specific steps (numbered continuation)
- Everything else — unchanged

**What it never touches:** the project's actual files, CLAUDE.md, database schema, or seed docs.

#### Skills Index — Implementation Sketch

`templates/_base/skills/INDEX.md` — a single file listing every available skill with its trigger phrases. Claude reads this when it needs to discover which skill applies to a request, instead of scanning 29+ individual SKILL.md files.

Format:
```markdown
# Skills Index

## Language
| Skill | Path | Use when |
|-------|------|----------|
| JavaScript | _base/skills/lang-javascript | "javascript", "node.js", "ESM", "async await" |
| TypeScript | _base/skills/lang-typescript | "typescript", "Zod", "strict types" |
...

## Animation
| Skill | Path | Use when |
|-------|------|----------|
| GSAP | _base/skills/anim-gsap | "GSAP", "GreenSock", "ScrollTrigger", "timeline animation" |
| Framer Motion | _base/skills/anim-framer-motion | "Framer Motion", "React animation", "AnimatePresence" |
...
```

Each project type's `project.json` gains a `catalog_skills` array pointing to the most relevant `_base` skills for that context — so Claude has a shorter, pre-filtered list to reason over rather than the full 29-entry index.

---

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
| Agent-side tracing (inside-agent spans) | ~200 lines | Trace the agent's reasoning loop, tool selection decisions, and LLM calls from inside the agent — not just the workbench API calls. Add `withSpan` equivalents to the Python scaffolds (custom, AutoGen, CrewAI, LangGraph) so each loop iteration, tool decision, and inner LLM call produces spans that flow through the same OTel pipeline into Tempo/Grafana. Currently we see tool calls arrive at the API but not the decision process that produced them. |
| GraphRAG integration (Neo4j) | ~500 lines | Entity-relationship search alongside vector search |
| Conversation-level evals | ~300 lines | Multi-turn behavioral tests with context carryover |
| Agent cost tracking | ~100 lines | Track LLM token usage and costs per project |
| Webhook notifications | ~100 lines | Push events to external URLs on job completion |

---

## PENDING: Skills Build Plan

### What Skills Are (vs Seed Docs)

**Seed docs** are reference material ingested into the knowledgebase. "Here are the patterns for microservices architecture." Claude searches them with `/query`.

**Skills** are procedural checklists — step-by-step instructions for accomplishing a specific repeating task. "When adding a new microservice to this project, do these 12 things in this order, modify these files, verify with this checklist." Claude follows them as a workflow.

Seed docs answer "what are the best practices?" Skills answer "what do I do right now, step by step?"

### Skill File Format

Each skill is a directory with a SKILL.md file. Format inspired by the [claude-skills](https://github.com/alirezarezvani/claude-skills) repo (313+ skills, MIT license):

```
templates/<type>/skills/
├── add-api-endpoint/
│   └── SKILL.md
├── add-database-table/
│   └── SKILL.md
└── ...
```

Each SKILL.md contains:
- **When to use** — trigger conditions (what the user asks for that activates this skill)
- **Prerequisites** — what must exist before starting
- **Steps** — numbered, specific actions to take
- **Templates/boilerplate** — code that gets reused each time
- **Checklist** — what to verify when done
- **Files involved** — which files to create or modify
- **Common mistakes** — things to watch out for

### Skills Per Project Type (~36 + 4 React = 40 total)

#### React Skills (add to fullstack type) — 4 skills

| Skill | What it teaches |
|-------|----------------|
| `storybook-setup` | Install Storybook, write stories for components, configure addons (controls, actions, a11y), organize story hierarchy |
| `component-types` | Presentational vs container components, Higher-Order Components (HOC), custom hooks, render props, compound components — when to use which pattern |
| `state-solutions` | useState for local, useReducer for complex local, Zustand for simple global, Redux Toolkit for complex global, Jotai for atomic. Decision flowchart + migration paths |
| `component-testing` | React Testing Library + Vitest setup, testing user interactions, testing async behavior, mocking API calls, snapshot testing pros/cons |

#### fullstack (5 skills)

| Skill | What it covers |
|-------|---------------|
| `add-api-endpoint` | Route + service + schema + test. Validation with Zod. Error responses. |
| `add-database-table` | Migration file, model/types, CRUD service, seed data. |
| `add-authentication` | JWT or session auth to a route. Middleware pattern. Protected routes. |
| `write-integration-tests` | Test setup, fixtures, database seeding, API endpoint testing, cleanup. |
| `error-handling-middleware` | Centralized error handler, structured error responses, logging, validation errors. |

#### pwa (4 skills)

| Skill | What it covers |
|-------|---------------|
| `add-cache-strategy` | Choose strategy (cache-first, network-first, stale-while-revalidate), implement in service worker, test offline. |
| `setup-push-notifications` | VAPID keys, service worker push handler, subscription flow, server-side sending. |
| `add-offline-fallback` | Offline page, cache app shell, detect online/offline, queue failed requests. |
| `lighthouse-audit-fix` | Run audit, interpret scores, fix performance/a11y/PWA issues, re-audit. |

#### cli (3 skills)

| Skill | What it covers |
|-------|---------------|
| `add-subcommand` | Define command + flags + args, implement handler, add help text, write test. |
| `add-config-file` | Config file discovery (project → user → defaults), schema validation, merge hierarchy. |
| `publish-package` | npm/PyPI/crates.io. Version bump, changelog, build, publish, verify. |

#### rag (4 skills)

| Skill | What it covers |
|-------|---------------|
| `ingest-and-validate` | Ingest a corpus, check /status, run /eval, interpret MRR, iterate on quality. |
| `tune-search-quality` | Adjust vector/keyword weights, chunk size, overlap. Before/after eval comparison. |
| `add-data-source` | New file type or API source. Extraction, chunking, metadata tagging. |
| `export-rag-stack` | Export to production. Verify migrations, test exported stack, seed data. |

#### agent (5 skills)

| Skill | What it covers |
|-------|---------------|
| `add-agent-tool` | Define tool schema (Anthropic format), implement handler, test with mock, add to agent loop. |
| `write-agent-eval` | Define scenarios, write expectations, run agent_eval, interpret results, fix failures. |
| `add-guardrails` | System prompt boundaries, tool permission scoping, output validation, testing guardrails. |
| `debug-agent-loop` | Enable debug mode, step through tool calls, approve/reject, diagnose infinite loops. |
| `connect-external-api` | Add httpx client, define tool, handle auth (API keys, OAuth), error handling, rate limiting. |

#### multi-agent (4 skills)

| Skill | What it covers |
|-------|---------------|
| `add-agent-role` | Define system prompt, create agent function, wire into team, test independently. |
| `switch-orchestration-pattern` | Evaluate current pattern, migrate (e.g., sequential → hierarchical), update main.py, test. |
| `debug-inter-agent-comms` | Read bus channels, trace message flow, identify stuck agents, fix coordination issues. |
| `run-multi-agent-eval` | Define team-level scenarios, test coordination (not just individual agents), measure team output quality. |

#### microservices (6 skills)

| Skill | What it covers |
|-------|---------------|
| `add-new-service` | Create service directory, Dockerfile, health checks, register in compose/k8s, add to CI. |
| `setup-inter-service-comms` | Choose sync (REST/gRPC) vs async (queue/events), implement client + server, add retry + circuit breaker. |
| `add-service-observability` | Structured logging, Prometheus metrics, distributed tracing, Grafana dashboard, alerting rules. |
| `production-readiness-review` | Run Susan Fowler checklist (8 standards), document gaps, create remediation plan. |
| `add-terraform-module` | Create module (variables, resources, outputs), wire into environments, plan + apply, test. |
| `deploy-new-environment` | Clone environment config, adjust variables (sizing, access), init + plan + apply, smoke test. |

#### data-pipeline (3 skills)

| Skill | What it covers |
|-------|---------------|
| `add-data-source` | Extraction script, schema definition, connection config, test with sample data. |
| `add-data-quality-checks` | Row count assertions, value range checks, referential integrity, freshness monitoring. |
| `schedule-pipeline` | Cron/queue/event-driven triggering, idempotency, monitoring, failure alerts. |

#### custom (2 skills)

| Skill | What it covers |
|-------|---------------|
| `setup-project-structure` | Choose language/framework, create directory structure, init package manager, first test. |
| `add-workbench-rag` | Ingest docs, configure search, add /query to workflow, tune with /eval. |

### Reference: claude-skills Repo

The [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) repo (313+ skills, MIT license) was reviewed as reference. Relevant items that should inform our skill authoring:

**Skills directly relevant to our project types:**
- `agent-designer` — multi-agent orchestration, tool schema design
- `rag-architect` — chunking optimization, retrieval evaluation
- `database-designer` — schema analysis, ERD generation, migration patterns
- `ci-cd-pipeline-builder` — stack detection → pipeline generation
- `mcp-server-builder` — MCP servers from OpenAPI specs
- `observability-designer` — SLO design, alert optimization, dashboard generation
- `senior-architect` — architecture review patterns

**Format conventions to adopt:**
- Each skill is a directory with `SKILL.md` + optional `scripts/`, `references/`, `templates/`
- Frontmatter with metadata (name, domain, triggers)
- Clear separation of instructions vs reference material
- Python CLI tools for automation (all stdlib-only)

**What they don't have that we provide:**
- Project-type-specific procedural skills (theirs are domain-general)
- Workbench integration (MCP tools, message bus, debug holds)
- Scaffold/import/export lifecycle

### Build Order

1. **React skills (4)** — ✅ DONE: `storybook-setup`, `component-types`, `state-solutions`, `component-testing` in `templates/fullstack/skills/`
2. **fullstack (5)** — ✅ DONE: `add-api-endpoint`, `add-database-table`, `add-authentication`, `write-integration-tests`, `error-handling-middleware` in `templates/fullstack/skills/`
3. **agent (5)** — ✅ DONE: `add-agent-tool`, `write-agent-eval`, `add-guardrails`, `debug-agent-loop`, `connect-external-api` in `templates/agent/skills/`
   **multi-agent (4)** — ✅ DONE: `add-agent-role`, `switch-orchestration-pattern`, `debug-inter-agent-comms`, `run-multi-agent-eval` in `templates/multi-agent/skills/`
4. **Zero Trust skills (4)** — ✅ DONE: agent: `zero-trust-identity`, `design-hitl-checkpoints`, `setup-circuit-breakers`; multi-agent: `inter-agent-trust-policy` (see `docs/17-zero-trust-agent-architecture.md`)
5. **microservices (6)** — ✅ DONE: `add-new-service`, `setup-inter-service-comms`, `add-service-observability`, `production-readiness-review`, `add-terraform-module`, `deploy-new-environment` in `templates/microservices/skills/`
6. **rag (7)** — ✅ DONE: `ingest-and-validate` (+ multi-source synthesis), `tune-search-quality`, `add-data-source`, `export-rag-stack`, `query-rewriting`, `source-citation`, `rag-with-conversation-context` in `templates/rag/skills/`
   - ⏳ DEFERRED: `adaptive-chunking` — blocked on RAG worker feature (sentence/paragraph/document-level chunking not yet supported; requires extending `apps/rag-worker/lib/worker.py` to support multiple index granularities or hierarchical chunking)
   - 📋 AGENT SKILLS AUDIT NEEDED: `routing-to-tools` concept (when to use RAG vs. SQL vs. web search) belongs in `templates/agent/skills/`. Audit existing agent skills against same dimensions used in RAG audit: dynamic query formulation, grounded output, multi-source synthesis, context memory, adaptive behavior, tool routing. Add a `route-to-tools` skill and any other gaps found.
7. **cli (3)** — ✅ DONE: `add-subcommand`, `add-config-file`, `publish-package` in `templates/cli/skills/`
   **pwa (4)** — ✅ DONE: `add-cache-strategy`, `setup-push-notifications`, `add-offline-fallback`, `lighthouse-audit-fix` in `templates/pwa/skills/`
   **data-pipeline (6)** — ✅ DONE: `add-pipeline-stage`, `idempotency-and-incremental-loads`, `pipeline-failure-recovery`, `evolve-pipeline-schema`, `setup-cdc-source`, `stream-vs-batch-decision` in `templates/data-pipeline/skills/`
   - ⏳ DEFERRED: `event-driven-pipeline-trigger` — event-triggered pipeline execution replacing cron (Bellemare ch. on event topology)
   **microservices (additional 3)** — ✅ DONE: `implement-outbox-pattern`, `cqrs-read-model`, `single-writer-principle` added to `templates/microservices/skills/` (total: 9)
   **custom (2)** — ✅ DONE: `setup-project-structure`, `add-mcp-tool-integration` in `templates/custom/skills/`
8. **Production deployment skills** — ✅ DONE (HIGH + MEDIUM priority)
   - ✅ fullstack: `production-config-and-secrets`, `setup-health-and-observability`, `security-hardening`
   - ✅ agent: `production-agent-deployment`, `llm-cost-and-rate-management`
   - ✅ multi-agent: `production-multi-agent-deployment`, `multi-agent-failure-handling`
   - ✅ rag: `production-rag-operations`
   - ✅ pwa: `production-pwa-deployment`
   - ✅ cli: `cli-production-ux`
   - DEFERRED (LOW): pwa `pwa-error-monitoring`; microservices additions; custom checklist in `setup-project-structure`
   - Note: data-pipeline `idempotency-and-incremental-loads` and `pipeline-failure-recovery` were written as data-pipeline skills (item 7) — not duplicated here
9. **IoT / ROS2 project type (new type)** — ✅ DONE: `templates/iot/` complete.
   - `project.json` — type, roadmap, 8 skills, 4 seed docs, framework list (ros2-python, mqtt-only), notes on hardware gap, real-time, safety
   - **Seed docs (4):** `ros2-patterns.md` (lifecycle, topics/services/actions, QoS, launch files, testing), `iot-protocols.md` (MQTT, serial, I2C, Modbus, OPC-UA), `network-device-patterns.md` (SNMP, SSH/netmiko, REST, gNMI), `edge-deployment.md` (multi-arch Docker, systemd, OTA, hardware access)
   - **Skills (8):** `scaffold-ros2-workspace`, `create-ros2-node`, `ros2-simulation` (mock/real abstraction), `connect-mqtt-broker`, `add-sensor-interface`, `write-robot-controller` (mandatory safety layer), `add-network-device-interface`, `deploy-to-edge`
   - **Decisions:** ROS2 Jazzy (LTS 2029), mock-only simulation (no Gazebo dependency), Python-first, combined network-device-interface skill
   - See `docs/19-iot-ros2-project-type-plan.md` for full design rationale
10. **DDD foundation skills (5 — cross-cutting, mandatory before new projects)** — ✅ DONE: `event-storming`, `define-bounded-contexts`, `design-aggregates`, `model-domain-events`, `ubiquitous-language` in `templates/_base/skills/`
    - `event-storming` is the mandatory pre-project workshop; referenced in `templates/_base/project.json` as `foundation_skills`
    - Apply retroactively: reference these skills from the roadmap of each project type's `project.json`
    - ✅ DONE: All 9 project type roadmaps updated with "Step 0: Foundation skills" pointing to DDD skills
11. **Environment management skills (DEFERRED — requires workbench investigation)**
    - **Problem:** No skills or workbench support for managing unpublished-work (dev/staging) environments vs. published-work (dev/staging/production) environments. Current workflow conflates workbench development with pre-production deployment.
    - **Two tiers of concern:**
      1. *Unpublished projects* (in active development): dev environment = workbench itself; staging = a second Docker Compose stack or a cloud dev environment. No skill covers this.
      2. *Published projects* (live in production): need dev → staging → production promotion gates, environment-specific config, database migrations per environment, and rollback procedures. The microservices `deploy-new-environment` skill touches this but only for Terraform-managed cloud infra.
    - **Workbench investigation needed:** Does `make export-stack` support multi-environment output? Can `PROJECT_DIR` and `WORKBENCH_PROJECT` be namespaced per environment? Should the workbench register separate project entries per environment (e.g., `myapp-dev`, `myapp-staging`, `myapp-prod`)?
    - **Proposed skills (pending investigation):** `setup-dev-environment`, `promote-to-staging`, `promote-to-production`, `environment-config-management`, `rollback-environment`
    - **Build after:** Production deployment skills (item 8 above) are a prerequisite — they establish what "production-ready" means before we design the promotion workflow.
12. **Design skills (10 — cross-cutting, in `templates/_base/skills/`)** — ✅ DONE
    - Theory (for designer discussion): `visual-design-principles`, `color-theory-and-systems`, `typography-system`, `layout-and-composition`, `ux-principles-and-patterns`, `ux-research-methods`
    - Implementation: `design-system-setup`, `responsive-layout-patterns`, `accessibility-implementation`, `animation-and-motion`
    - Added to `templates/_base/project.json` as `design_skills` array
    - Referenced from `fullstack` and `pwa` project.json `design_skills` arrays
    - Theory skills: optimized for informed discussion with a professional designer; implementation sections supplementary
13. **Cross-project-type skill sharing and project type composition** — IN PROGRESS
    - Skills currently live in one project type's directory; cross-cutting skills use `_base/`
    - ✅ Hierarchy designed: 28 cross-cutting skills across 7 tiers — see `docs/22-programming-skills-hierarchy.md`
    - ✅ Composition model documented: Elixir-channel model (provides/consumes schema, capability substitutability, coordinator options) — see `docs/21-elixir-channel-project-type-composition.md`
    - ✅ `ux-research-methods` and `design-system-setup` added to `foundation_skills` (DDD phase) in `_base/project.json`
    - ✅ DONE: All 28 programming/infra/platform/animation skills built in `templates/_base/skills/` (see `docs/22-programming-skills-hierarchy.md` for full inventory)
    - ✅ DONE: `templates/_base/skills/INDEX.md` — 116 skills, organized by domain, trigger phrases for each. Referenced from `_base/project.json` as `skills_index`. Each project-type section links to its `capability.json` contract.
    - ✅ DONE: `make add-capability` — reads `templates/<type>/capability.json` (preferred) or falls back to `project.json`. Union-merges `mcp_tools`, `skills`, `provides[]`, `consumes[]`, `capabilities[]`. Idempotent. Port bug fixed (was 3200, now 3100). New targets: `make show-capability CAPABILITY=rag`, `make list-capabilities`.
    - ✅ DONE: `templates/<type>/capability.json` contracts for all 10 types — single source of truth for `provides`/`consumes` tokens used by add-capability, coordinator, and INDEX.md. Capability token vocabulary: `hybrid_search`, `document_ingestion`, `agent_reasoning`, `tool_use`, `agent_memory`, `multi_agent_coord`, `message_bus`, `rest_api`, `web_interface`, `offline_support`, `cli_interface`, `data_transform`, `stream_processing`, `sensor_data`, `ros2_nodes`, `mqtt_messaging`, `edge_deployment`, `infrastructure_as_code`, `embedding_service`, `llm_api`.
    - ✅ DONE: `GET /capabilities` and `GET /capabilities/:token` routes — `CapabilityProvider` Zod schema, `groupByCapability` pure helper, shape-mismatch fix (string-token array), 11 tests. Coordinator `resolveProvider()` can now call the live API.
    - ✅ DONE: Coordinator skill rewritten — correct port (3100), precise token vocabulary, references `capability.json` and `docs/23-design-principles-guide.md`, 4 patterns (peer/additive/event/agent-as-coordinator), bus channel naming convention.

### How to Build (instructions for Claude Code)

For each skill:

1. Create `templates/<type>/skills/<skill-name>/SKILL.md`
2. Follow the format: When to use → Prerequisites → Steps → Templates → Checklist → Files involved → Common mistakes
3. Steps should be specific and actionable — "create file X at path Y with content Z" not "set up the thing"
4. Include actual code templates where applicable (boilerplate that gets reused)
5. Reference workbench tools where relevant (`/ingest`, `/query`, `/eval`, `agent_eval`, `bus_read`, `debug_enable`)
6. Keep each skill focused on ONE workflow — if it does two things, split it
7. After creating all skills for a type, update the type's `project.json` to reference them
8. Update `docs/project-state.md` to reflect completion
