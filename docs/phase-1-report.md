# Phase 1 Report — Multi-Project, Test Runner, Foundation Refactor

## What Was Built

Phase 1 transforms the workbench from a single-project tool into a multi-project development platform. Four deliverables were completed:

1. **Multi-project database support** — one PostgreSQL database per project, managed via a workbench registry
2. **Test runner MCP tool** — auto-detecting, project-aware test execution with structured results
3. **Foundation refactor** — dependency injection, pure utility extraction, modular schemas, direct PostgreSQL
4. **Project management API + CLI** — CRUD for projects via REST and Makefile

## Why These Changes

### Multi-project support (the primary goal)

The workbench was designed for one project at a time. Switching projects meant losing your knowledgebase or manually backing up and restoring. Now each project gets its own PostgreSQL database with complete isolation. You can work on five projects across the week and each one's RAG data, embeddings, and search state is independent.

The multi-database approach was chosen over schema isolation (single database, project_id column) because:
- A project's database can be backed up, restored, or dropped independently
- Queries don't need WHERE clauses on every operation — the isolation is at the connection level
- Projects on ice can have their databases dropped, with a backup in `.workbench/` for later revival
- See `docs/10-multi-project-architecture.md` for the full decision analysis

### Dependency injection (the architectural change)

Previously, services called `getSupabase()` — a global singleton. This meant every service was tightly coupled to one database. Now services receive a `Db` connection as their first parameter:

```typescript
// Before: service decides which database
export async function hybridSearch(question: string) {
  const supabase = getSupabase();  // hardcoded singleton
  // ...
}

// After: caller provides the database
export async function hybridSearch(db: Db, question: string) {
  // db could be any project's database
  // ...
}
```

This single change enables multi-project support without services knowing or caring which project they're operating on. The project middleware resolves the project and provides the right database connection; the services just work.

### Pure utility extraction (testability)

`chunkText()` and `sha256()` were extracted from the monolithic `ingest.ts` into standalone modules (`lib/chunker.ts`, `lib/hash.ts`). They're pure functions with no side effects — they take input, return output, touch nothing else. This makes them trivially testable (16 tests for chunker alone) and reusable across services.

### Supabase JS → postgres.js (the database client change)

The Supabase JavaScript client was replaced with `postgres.js` for direct PostgreSQL connections. Why:
- Supabase JS connects through PostgREST (an HTTP API over Postgres). Multi-database support would require running a separate PostgREST per project — heavy and unnecessary.
- `postgres.js` connects directly to PostgreSQL, supports multiple databases natively (one pool per database), and uses tagged template literals for safe SQL.
- The MCP server is already the API gateway — there's no need for a second API layer (PostgREST) in between.

PostgREST and Kong remain in docker-compose for Supabase Studio and any direct REST API usage, but the MCP server no longer depends on them.

## Architecture After Phase 1

```
Request → Fastify
            │
            ├── /health          → health handler (no project context)
            ├── /projects/*      → project CRUD (registry database)
            └── /ingest, /query, /status, /test, /reindex
                    │
                    ▼
              Project Middleware
              (resolves project from URL / header / env)
                    │
                    ▼
              getProjectDb(projectName)
              (returns connection pool for that project's database)
                    │
                    ▼
              Service Layer (receives Db as parameter)
              ├── ingestDocument(db, filepath)
              ├── hybridSearch(db, question, options)
              ├── runTests(projectDir, command, timeout)
              └── ...
```

## Files Changed or Created

### New files

| File | Purpose |
|------|---------|
| `src/lib/chunker.ts` | Pure text chunking utility (extracted from ingest.ts) |
| `src/lib/hash.ts` | Pure SHA256 hashing utility (extracted from ingest.ts) |
| `src/services/db.ts` | Connection pool manager — one pool per project database |
| `src/services/projects.ts` | Project CRUD + database lifecycle (create, drop, migrate) |
| `src/services/test-runner.ts` | Test command auto-detection + execution |
| `src/middleware/project.ts` | Request → project resolution middleware |
| `src/schemas/rag.ts` | RAG schemas (extracted from monolithic schemas/index.ts) |
| `src/schemas/project.ts` | Project + test runner schemas |
| `src/routes/health.ts` | Health check route (standalone) |
| `src/routes/projects.ts` | Project CRUD routes |
| `src/routes/rag.ts` | RAG + test routes (project-scoped) |
| `src/__tests__/lib/chunker.test.ts` | 11 tests for chunking |
| `src/__tests__/lib/hash.test.ts` | 5 tests for hashing |
| `src/__tests__/schemas/schemas.test.ts` | 19 tests for all schemas |
| `vitest.config.ts` | Test configuration |
| `configs/claude/commands/test.md` | /test slash command |

### Refactored files

| File | What changed |
|------|-------------|
| `src/config.ts` | Supabase vars → direct PG vars (pgHost, pgPort, pgUser, pgPassword, pgRegistryDb) |
| `src/schemas/index.ts` | Now re-exports from rag.ts + project.ts (split from monolith) |
| `src/services/ingest.ts` | Takes `Db` parameter, uses `lib/chunker` + `lib/hash`, direct SQL |
| `src/services/search.ts` | Takes `Db` parameter, direct SQL instead of Supabase RPC |
| `src/routes/index.ts` | Wires health + project + RAG route modules + middleware |
| `src/index.ts` | Calls `ensureRegistry()` on startup, graceful shutdown |
| `src/mcp/index.ts` | Project-aware, adds `project_test` tool |
| `configs/mcp/bridge/index.js` | Sends `X-Project` header, adds `project_test` tool |
| `docker-compose.yml` | Direct PG env vars, WORKBENCH_PROJECT passthrough, migrations volume |
| `.env.example` | Added WORKBENCH_PROJECT, removed ENABLE_RAG |
| `package.json` | Replaced `@supabase/supabase-js` with `postgres`, added `vitest` |
| `Makefile` | Added project management targets |

### Removed files

| File | Reason |
|------|--------|
| `src/services/supabase.ts` | Replaced by `src/services/db.ts` (direct Postgres) |

## Test Results

```
 ✓ src/__tests__/lib/chunker.test.ts (11 tests)
 ✓ src/__tests__/lib/hash.test.ts (5 tests)
 ✓ src/__tests__/schemas/schemas.test.ts (19 tests)

 Test Files  3 passed (3)
      Tests  35 passed (35)
```

## User Interfaces

### Makefile Commands

```bash
# Register a new project
make project NAME=nexus DIR=~/code/nexus TYPE=fullstack

# List all registered projects
make list-projects

# Drop a project and its database
make drop-project NAME=nexus

# Backup a project's knowledgebase
make backup-project NAME=nexus

# Restore a project's knowledgebase
make restore-project NAME=nexus BACKUP=backups/nexus-20260514.sql.gz
```

### REST API

**Project management (no project context needed):**

```bash
# List projects
GET /projects

# Create project
POST /projects
{"name": "nexus", "directory": "/home/user/code/nexus", "type": "fullstack"}

# Get project details
GET /projects/nexus

# Delete project + database
DELETE /projects/nexus

# Update project config
PATCH /projects/nexus/config
{"test_command": "npm run test:unit", "search_config": {"vector_weight": 0.8}}
```

**RAG operations (project context required):**

Three ways to specify the project:

```bash
# 1. URL parameter
POST /p/nexus/ingest    {"filepath": "/workspace/documents/file.txt"}
POST /p/nexus/query     {"question": "What is X?"}
GET  /p/nexus/status

# 2. X-Project header
curl -X POST http://localhost:3100/ingest \
  -H "X-Project: nexus" \
  -H "Content-Type: application/json" \
  -d '{"filepath": "/workspace/documents/file.txt"}'

# 3. WORKBENCH_PROJECT env var (set in .env, used by MCP bridge)
WORKBENCH_PROJECT=nexus
# Then: POST /ingest, POST /query, etc. (no project in URL or header)
```

**Test runner:**

```bash
# Auto-detect test command
POST /p/nexus/test
{}

# Explicit command
POST /p/nexus/test
{"command": "pytest -v --tb=short", "timeout": 60}
```

Response:
```json
{
  "status": "passed",
  "command": "npm test",
  "exit_code": 0,
  "stdout": "... test output ...",
  "stderr": "",
  "duration_ms": 3421
}
```

### MCP Tools (via Claude Code)

All existing tools now include the `project_test` tool:

```
rag_ingest     — ingest documents (unchanged interface)
rag_query      — hybrid search + answer (unchanged interface)
rag_status     — knowledgebase stats (now includes project name)
rag_reindex    — re-embed everything (unchanged interface)
project_test   — NEW: run the project's test suite
```

The MCP bridge reads `WORKBENCH_PROJECT` from the environment and sends it as an `X-Project` header on every API call. Set it in `.env` or pass it when starting Claude Code.

### Slash Commands

```
/test                          → auto-detect and run project tests
/test pytest -v --tb=short     → explicit test command
/ingest documents/file.txt     → ingest into current project's knowledgebase
/query What is the auth flow?  → search current project's knowledgebase
/status                        → current project's knowledgebase stats
```

## Typical Workflow

### Setting up a new project

```bash
# 1. Start the workbench (if not running)
make up

# 2. Register the project
make project NAME=nexus DIR=~/code/nexus TYPE=fullstack

# 3. Set it as active and enter Claude Code
WORKBENCH_PROJECT=nexus PROJECT_DIR=~/code/nexus docker compose up -d claude-code
make claude

# Inside Claude Code:
> /status           # confirm project knowledgebase is empty
> /ingest documents/architecture.md
> /test             # run the test suite
```

### Switching projects

```bash
# Update .env
WORKBENCH_PROJECT=my-other-project
PROJECT_DIR=~/code/my-other-project

# Restart claude-code with new project
docker compose up -d claude-code
make claude
```

### Working on a project without RAG

Register the project but never ingest documents. All MCP tools still work — `/status` shows zero documents, `/query` returns "no relevant documents." The test runner works independently of RAG.

## What's Next (Phase 2)

Phase 2 adds AI-native affordances:
- Conversation history store + MCP tools
- Search quality evaluation (`/eval`)
- Agent memory tools (`agent_remember` / `agent_recall`)
- Ingestion and search Grafana dashboards
