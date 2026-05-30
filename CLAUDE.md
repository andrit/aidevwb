# AI Dev Workbench

## What This Is

A portable Docker-based AI development environment with multi-project support, RAG/MCP infrastructure, agent framework scaffolding, observability, and production export. 22 MCP tools, 166 tests, 251 files.

The workbench helps build any kind of application — web apps, CLIs, RAG apps, autonomous agents, multi-agent systems — with AI-native development tooling.

## How to Work on This Project

### Follow These Principles — Always

**TDD (Test-Driven Development):** Write tests alongside or before code. Every new feature ships with tests. Pure functions get unit tests. Schemas get validation tests. Run `npm test` before committing. The test suite must pass at 100% — no skipped tests, no known failures.

**DDD (Domain-Driven Design):** Organize by feature domain, not by technical layer. Each feature gets its own schema, service, route, and test files. A new capability = new files in each layer, not modifications to monolithic files.

**Modular:** Every file does one thing. Services receive dependencies as parameters (dependency injection), not from global singletons. Functions are small, focused, and composable. If a function exceeds ~50 lines, it probably needs extraction.

**DRY (Don't Repeat Yourself):** Zod schemas are the single source of truth — never duplicate type definitions. Use shared factories (Redis, template renderer, span attributes). Extract repeated patterns into `lib/` utilities. If you find yourself writing similar code in two places, extract it.

**Never overwrite project files:** When the workbench interacts with an existing project directory (import, export, scaffold), it must NEVER overwrite files that already exist. Create new files in `.workbench/` only. OFFER to append to existing files with user confirmation. See `docs/11-project-types-and-affordances.md` for the full import-vs-new spec.

### Create Skill Files for Repeated Patterns

If you find yourself doing the same kind of task more than twice, create a skill file. Skills capture reusable patterns, templates, and checklists so the workbench (and you) can do them consistently.

Skill file locations:
- `templates/<type>/skills/<skill-name>/SKILL.md` — project-type-specific skills (shipped with the workbench)
- `/mnt/skills/user/` — user-created skills (read by Claude Code automatically)

A skill file MUST include these sections in this order:
1. **When to use** — the trigger conditions (what the user asks that activates this skill)
2. **Prerequisites** — what must exist before starting
3. **Steps** — numbered, specific actions ("create file X at path Y with content Z", not "set up the thing")
4. **Templates** — actual code boilerplate that gets reused each time
5. **Checklist** — what to verify when done
6. **Files involved** — which files to create or modify
7. **Common mistakes** — things to watch out for

Examples of things that should become skills:
- Adding a new MCP tool (schema → service → route → bridge → test → slash command)
- Adding a new project template type (project.json → seed-docs → scaffold files)
- Adding a new database table (migration → schema → service → route → tests)
- Instrumenting a service with OTel tracing
- Creating a new Grafana dashboard
- The workflows necessary to build each of the project types (see `docs/project-state.md` — PENDING: Skills Build Plan)

**There is a pending plan to build ~40 skills across all 9 project types plus React skills.** See `docs/project-state.md` section "PENDING: Skills Build Plan" for the full inventory, format, build order, and instructions. Start with React skills (4), then fullstack (5), then agent (5) + multi-agent (4).

**Reference catalog:** The [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) repo (313+ skills, MIT license) has been reviewed. Relevant skills: agent-designer, rag-architect, database-designer, ci-cd-pipeline-builder, mcp-server-builder, observability-designer, senior-architect. Use their format conventions (SKILL.md with frontmatter, scripts/, references/) as inspiration.

### Before Instructing the User to Run Commands

Always check and mention prerequisites before telling the user to run a command:
- **`make init` / `make up` / `make build`** — does `package-lock.json` exist in `apps/mcp-server/`? If not, tell the user to run `cd apps/mcp-server && npm install && cd ../..` first.
- **Any Docker command** — remind that Docker Desktop must be running if there's reason to think it might not be.
- **Any `npm ci` or `npm run build`** — requires `package-lock.json`. If it was deleted or never generated (e.g., fresh clone from a zip without it), `npm install` must run first.
- **Python scripts** — check if `pip install -r requirements.txt` is needed.
- **Terraform commands** — check if `terraform init` has been run in that environment.
- **Make targets that call curl** — check if services are running (`make up` first).

Never assume the user's environment is already set up. State prerequisites explicitly.

1. Read the relevant docs first — they contain decisions, context, and constraints
2. Check `docs/project-state.md` for the current inventory and what's been built
3. Verify your plan aligns with the architecture before writing code
4. Ask before making structural changes (new layers, new dependencies, new patterns)

### When Adding Code

1. **Schema first** — define the data shape in `src/schemas/`. Re-export from `schemas/index.ts`.
2. **Pure logic in lib/** — if any logic is pure (no I/O), put it in `src/lib/` and test it directly.
3. **Service** — business logic in `src/services/`. Takes `Db` as first param if project-scoped.
4. **Route** — HTTP handler in `src/routes/`. Validates with Zod, calls service, returns result.
5. **Register** — add to `routes/index.ts` inside `registerProjectScopedRoutes()` or at the top level.
6. **MCP bridge** — add tool definition + handler to `configs/mcp/bridge/index.js`.
7. **Tests** — schema tests, pure function tests, and any integration tests needed.
8. **Type check + build** — `npx tsc --noEmit` then `npx tsc` then `npx vitest run`.

### When Modifying Code

1. `view` the file before editing — never edit from memory.
2. After any successful `str_replace`, the file has changed — re-`view` before further edits.
3. Run `npx tsc --noEmit` after changes to catch type errors early.
4. Run `npx vitest run` to verify no tests broke.

## Architecture

### Language Split

- **TypeScript + Fastify + Zod** — API orchestration, MCP tools, HTTP routing, validation
- **Python** — RAG worker (multimodal document processing), agent scaffolds

### Database

- **PostgreSQL + pgvector** — one database per project (multi-database, not schema isolation)
- **`workbench` database** — registry of all projects
- **`<project>` databases** — each project's docs, chunks, conversations, memories, eval runs
- **Connection management** — `getRegistryDb()` for registry, `getProjectDb(name)` for projects

See `docs/10-multi-project-architecture.md` for the full decision analysis.

### Services Map

```
Entry point:     src/index.ts (Fastify startup, tracing init, registry bootstrap)
Config:          src/config.ts (env vars → typed config, immutable after startup)
Schemas:         src/schemas/*.ts → index.ts re-exports all
Libs:            src/lib/*.ts (pure functions: chunker, hash, templates, frameworks, tracing, eval-scoring)
Middleware:       src/middleware/*.ts (project resolution, request tracing)
Services:        src/services/*.ts (business logic, receives Db as parameter)
Routes:          src/routes/*.ts (HTTP handlers, validates with Zod, calls services)
MCP:             src/mcp/index.ts (TS version), configs/mcp/bridge/index.js (plain JS, production)
Tests:           src/__tests__/{lib,schemas,services}/*.test.ts
```

### Request Flow

```
Request → Fastify → Tracing Hook (span) → Project Middleware (resolve Db)
  → Route Handler → Zod Validation → Service (with Db) → Response
```

### MCP Bridge

The bridge (`configs/mcp/bridge/index.js`) is a thin stdio↔HTTP translator. It runs in the `claude-code` container and calls the Fastify API in the `mcp-server` container over Docker network. It has zero business logic. See `docs/14-mcp-deep-dive.md`.

### Templates

```
templates/
├── _base/              — shared defaults (project.json, CLAUDE.md template, import append block)
├── _export/            — production stack templates (compose, terraform)
├── fullstack/          — fullstack web app
├── pwa/                — progressive web app
├── cli/                — command-line tool
├── rag/                — RAG application
├── agent/              — autonomous agent
│   ├── frameworks/     — autogen, crewai, langgraph, custom (each has scaffold/ + seed-docs/)
│   └── patterns/       — orchestration patterns library (patterns.py)
├── multi-agent/        — multi-agent system (scaffold with patterns.py + main.py)
├── data-pipeline/      — ETL/data processing
├── iot/                — IoT/ROS2 (robot nodes, MQTT sensors, edge deployment)
└── custom/             — all tools, no guidance
```

Template configs are deep-merged: `_base/project.json` + `<type>/project.json`. Types override base. See `docs/11-project-types-and-affordances.md`.

## Key Files

| File | What It Does | When to Modify |
|------|-------------|----------------|
| `src/config.ts` | All env vars → typed config | Adding a new config value |
| `src/schemas/index.ts` | Re-exports all schemas + zodToJsonSchema | Adding a new schema file |
| `src/routes/index.ts` | Registers all route modules | Adding a new route module |
| `src/services/db.ts` | Connection pool manager | Changing connection behavior |
| `src/services/projects.ts` | Project CRUD + DB lifecycle + migration list | Adding a new migration |
| `src/lib/tracing.ts` | OTel init + withSpan + spanAttrs | Adding a new trace category |
| `configs/mcp/bridge/index.js` | All 22 MCP tool definitions + handlers | Adding a new MCP tool |
| `docker-compose.yml` | All 11 services | Adding a service or changing config |
| `Makefile` | All CLI targets | Adding a new workflow command |

## Environment Variables

Required in `.env`:
```
ANTHROPIC_API_KEY        — Claude LLM + Claude Code auth
POSTGRES_PASSWORD        — PostgreSQL password
```

Optional:
```
WORKBENCH_PROJECT        — active project name (MCP bridge reads this)
PROJECT_DIR              — project directory mounted into claude-code
EMBEDDING_BASE_URL       — default: http://ollama:11434/v1 (local Ollama, no account needed)
EMBEDDING_API_KEY        — default: ollama
EMBEDDING_MODEL          — default: mxbai-embed-large
EMBEDDING_DIMENSIONS     — default: 1024
OPENROUTER_API_KEY       — only needed if switching to OpenRouter as embedding provider
CLAUDE_MODEL             — default: claude-sonnet-4-20250514
```

## MCP Tools (22)

```
RAG:           rag_ingest, rag_query, rag_status, rag_reindex, rag_eval
Memory:        agent_remember, agent_recall, agent_forget, agent_memories
Conversations: conversation_create, conversation_list, conversation_get, conversation_append
Bus:           bus_publish, bus_read, bus_channels
Debug:         debug_enable, debug_pending, debug_approve, debug_reject
Eval:          agent_eval
Dev:           project_test
```

## Slash Commands (9)

```
/ingest, /query, /status, /reindex, /test, /eval, /remember, /recall, /agent-eval
```

## Make Targets

```
# Setup
make init              — first-time bootstrap
make register-mcp      — re-register MCP bridge

# Core
make up / down / build / clean / logs

# Projects
make project NAME=x DIR=y TYPE=z    — register existing project
make scaffold NAME=x TYPE=z         — create new project from template
make list-projects                   — list all projects
make drop-project NAME=x            — drop project + database
make backup-project NAME=x          — backup to .workbench/
make restore-project NAME=x BACKUP=y

# Export
make export-stack NAME=x FORMAT=compose|terraform|migrations-only
make export-with-data NAME=x

# Cloud
make deploy-dev / deploy-prod
make tf-init-dev / tf-plan-dev / tf-apply-dev / tf-destroy-dev
```

## Database Migrations

Located in `supabase/migrations/`. Applied by `runMigrations()` in `services/projects.ts`. The migration file list is in that file — **add new migrations to the list when creating them**.

```
001_extensions.sql       — pgvector, pg_trgm
002_documents.sql        — documents table
003_chunks.sql           — document_chunks with vector + tsvector
004_hybrid_search.sql    — hybrid search function
005_conversations.sql    — conversations + messages
006_memory_eval.sql      — memories + eval_runs
```

## Documentation Reference

When working on a specific area, read the relevant doc first:

| Working On | Read |
|-----------|------|
| RAG pipeline | docs/06-rag-knowledgebase-infrastructure.md |
| Adding MCP tools | docs/14-mcp-deep-dive.md (section: "How to Expand MCP") |
| Request patterns | docs/13-request-patterns.md |
| Multi-project | docs/10-multi-project-architecture.md |
| Project templates | docs/11-project-types-and-affordances.md |
| Project types (DDD) | docs/16-project-types-explainer.md |
| Export/deploy | docs/12-exporting-to-production.md |
| Observability | docs/01-grafana.md, docs/02-tempo.md, docs/03-opentelemetry-collector.md |
| Agent frameworks | docs/phase-3a1-report.md |
| Agent eval | docs/15-agent-eval-framework.md |
| Tracing | docs/phase-3a2-report.md |
| Message bus | docs/phase-3a3-report.md |
| Orchestration patterns | docs/phase-3a4-report.md |
| Step-through debug | docs/phase-3a5-report.md |
| Overall project state | docs/project-state.md |
| Gaps and priorities | docs/design-note-four-skills.md |
| Mode A vs Mode B | docs/developing-vs-utilizing-workbench.md |
| Smoke testing | docs/SMOKE-TEST.md |
| **Skills build plan** | **docs/project-state.md → "PENDING: Skills Build Plan"** |

## Testing

```bash
cd apps/mcp-server
npx tsc --noEmit        # type check (fast, no output)
npx tsc                 # full build to dist/
npx vitest run          # run all 143 tests
npx vitest run --reporter=verbose  # detailed output
```

Test files mirror the source structure:
```
src/__tests__/
├── lib/
│   ├── chunker.test.ts         — 11 tests
│   ├── hash.test.ts            — 5 tests
│   ├── templates.test.ts       — 15 tests
│   ├── frameworks.test.ts      — 7 tests
│   ├── tracing.test.ts         — 7 tests
│   └── eval-scoring.test.ts    — 18 tests
├── schemas/
│   ├── schemas.test.ts         — 19 tests (Phase 1)
│   ├── phase2-schemas.test.ts  — 20 tests
│   ├── export.test.ts          — 5 tests
│   ├── bus.test.ts             — 14 tests
│   └── agent-eval.test.ts      — 12 tests
└── services/
    ├── conversations.test.ts   — 4 tests
    └── debug.test.ts           — 6 tests
```

## Verifying the Bridge

```bash
cd configs/mcp/bridge
timeout 3 node -e "import('./index.js').then(() => console.log('OK')); setTimeout(() => process.exit(0), 2000)"
```

## Moving Between Workstations

1. `make down` — auto-backups all projects to `.workbench/backup.sql.gz`
2. Copy/clone the repo + fill in `.env`
3. `make init` — builds, starts, bootstraps
4. `make project NAME=x DIR=y` — auto-restores from `.workbench/backup.sql.gz`
