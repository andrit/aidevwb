# Multi-Project Architecture — Database Strategy

This document captures the full decision process for how the workbench handles multiple projects, including the single-database vs multi-database analysis, lifecycle implications, and the chosen approach.

## The Problem

The workbench was initially designed for one project at a time. A single `PROJECT_DIR` env var points at your code, a single set of database tables holds your documents and chunks, and a single MCP bridge serves tools. To make the workbench a real daily driver across multiple projects, every piece of state needs to know which project it belongs to.

## Two Approaches Considered

### Option A: Schema Isolation (One Database, Project ID Column)

One Postgres database. Add a `project_id` column to `documents` and `document_chunks`. The `hybrid_search` function gets a `project_id` parameter. All queries filter by project.

**Data model:**

```
projects
├── id (uuid)
├── name ("nexus", "my-saas-app")
├── directory (absolute path on host)
├── config (jsonb — per-project MCP tools, embedding model overrides)
├── created_at
└── updated_at

documents
├── project_id (FK → projects.id)   ← NEW COLUMN
├── ... (existing columns)

document_chunks
├── ... (existing columns, inherits project via document_id FK)
```

**Pros:**
- Simplest migration (add a column + FK, update one function)
- Single connection pool
- Schema migrations run once
- PostgREST continues working as-is

**Cons:**
- No hard isolation — a query bug could leak chunks across projects
- Backup/restore requires filtering by project_id (partial pg_dump is complex)
- "Putting a project on ice" means deleting rows with a specific project_id across multiple tables
- Every query in every service needs `WHERE project_id = ...` appended

### Option B: Multiple Databases (One Per Project)

One PostgreSQL server, multiple databases. Each project gets its own database with its own copies of the `documents`, `document_chunks` tables and `hybrid_search` function.

**Data model:**

```
supabase-db (one container, one PostgreSQL server)
├── postgres          ← system/default database
├── workbench         ← registry: which projects exist, global config
├── nexus             ← project database: documents, chunks, embeddings
├── my_saas_app       ← project database: documents, chunks, embeddings
└── side_experiment   ← project database: documents, chunks, embeddings
```

**Pros:**
- Total isolation between projects
- `pg_dump` per project is self-contained (no filtering)
- Drop a database = clean removal of all project data
- Queries are unchanged from single-project code (no WHERE clauses added)
- Portability is simpler and more reliable

**Cons:**
- Connection pool per project (minor overhead)
- Schema migrations must run against each project database
- PostgREST connects to one database (needs workaround or bypass)

## Decision: Multiple Databases

The lifecycle argument was decisive. The workbench is a tool for exploring and building projects. Some projects will be abandoned, some will be put on hold, some will be promoted to production. The database needs to support this lifecycle cleanly:

**Start a project:**
```bash
# New project — scaffold from template, write all files
make scaffold TYPE=agent NAME=my-bot

# Existing project — import without overwriting anything
make project NAME=nexus DIR=~/code/nexus TYPE=fullstack
```

The workbench distinguishes between these two modes. For **new projects**, it creates a directory and writes all template files (CLAUDE.md, project structure, config). For **existing projects**, it must never overwrite files that already exist in the project directory — particularly CLAUDE.md, which the developer has already tailored to their project. The import flow scans for conflicts, offers to append workbench-specific sections to existing files (with a clear delimiter and user confirmation), and creates only the `.workbench/` directory as new. Seed docs for the knowledgebase are ingested into the database, never written to the project directory. See doc 11 ("Import vs New: Respecting Existing Projects") for the full specification.

**Put a project on ice:**
```bash
make backup-project NAME=side_experiment
# pg_dump → ~/code/side_experiment/.workbench/backup.sql.gz

make drop-project NAME=side_experiment
# DROP DATABASE side_experiment; removes from registry. Project directory untouched.
```

**Resume a project months later:**
```bash
make project NAME=side_experiment DIR=~/code/side_experiment
# Finds .workbench/backup.sql.gz, auto-restores. Back where you left off.
```

With schema isolation, "putting a project on ice" means carefully deleting rows with a specific project_id across multiple tables, hoping you don't miss any foreign key cascades. With separate databases, you drop one database. One command, total certainty.

## Impact on the API Layer

The API changes are cleaner with multiple databases than with schema isolation.

**Schema isolation approach:** every service function needs a `projectId` parameter threaded through, and every database query needs `WHERE project_id = ...` appended. This touches every file in the request path.

**Multiple database approach:** the API layer switches which database connection it uses per request. The queries themselves stay identical to single-project code. The `hybrid_search` function doesn't change at all. Each database has its own copy.

```typescript
// Current: one connection
const supabase = getSupabase();

// Multi-db: connection resolved from project context
const supabase = getSupabase(projectId);  // returns client pointing at that project's DB
```

That's the only signature change in the service layer. Every downstream function — `hybridSearch`, `ingestDocument`, `embedTexts` — stays the same because they receive a client and operate on it.

The MCP server resolves the project from the request (header, URL pattern, or env var in the MCP bridge) and picks the right connection pool. The rest of the code path is unchanged.

## Impact on the Portability Layer

Multiple databases make portability better, not harder.

Each project's `.workbench/backup.sql.gz` is a self-contained `pg_dump` of that project's entire database. No partial dumps, no project_id filtering. Just:

```bash
# Backup
pg_dump -U postgres nexus | gzip > backup.sql.gz

# Restore
createdb nexus
gunzip -c backup.sql.gz | psql -U postgres nexus
```

The `.workbench/` directory inside each project:

```
~/code/nexus/
├── .workbench/
│   ├── project.json        ← project config (name, tool settings, search weights)
│   ├── backup.sql.gz       ← full database backup (documents + chunks + embeddings)
│   └── documents.manifest  ← list of ingested files + SHA256 hashes
├── CLAUDE.md
├── src/
└── ...
```

**First time the workbench opens a project:**
1. Checks for `.workbench/project.json` — not found → this is a new registration
2. Checks whether the project directory already has files (CLAUDE.md, src/, package.json, etc.)
   - **Directory has existing files** → import mode: creates `.workbench/` only, scans for file conflicts, offers to append workbench sections to existing CLAUDE.md (never overwrites), ingests seed docs into database only
   - **Directory is empty or doesn't exist** → scaffold mode: writes all template files, creates full project structure
3. Creates the project database, runs migrations, registers in workbench registry
4. Ingests any seed docs for the chosen project type into the knowledgebase

**Subsequent opens:**
1. Finds `.workbench/project.json` → reads project name
2. If database doesn't exist (new machine), checks for `.workbench/backup.sql.gz` → auto-restores
3. You're right where you left off

**On close / project switch:**
1. Auto-exports project's database to `.workbench/backup.sql.gz`
2. Updates `documents.manifest` with current file hashes

## Per-Project Configuration

The `project.json` in `.workbench/` stores project-specific settings:

```json
{
  "name": "nexus",
  "embedding_model": "voyage/voyage-3",
  "embedding_dimensions": 1024,
  "mcp_tools": ["rag_ingest", "rag_query", "rag_status"],
  "custom_tools": [
    {
      "name": "run_tests",
      "command": "npm test",
      "description": "Run the project's test suite"
    }
  ],
  "search_config": {
    "vector_weight": 0.7,
    "text_weight": 0.3,
    "match_threshold": 0.5
  }
}
```

Some projects might not need RAG at all (empty `mcp_tools`). Some might have custom MCP tools specific to that project's stack. The MCP bridge reads the project config on startup and only exposes the relevant tools.

## Running Multiple Projects Simultaneously

One `claude-code` container per project, shared infrastructure:

```bash
# Terminal 1
PROJECT_DIR=~/code/nexus WORKBENCH_PROJECT=nexus docker compose run --rm claude-code claude

# Terminal 2
PROJECT_DIR=~/code/my-saas-app WORKBENCH_PROJECT=my-saas-app docker compose run --rm claude-code claude
```

The shared services (mcp-server, supabase-db, redis, observability) stay as single instances. Only claude-code containers multiply. Each passes a different project ID, which the MCP server uses to pick the right database connection.

## Cost Implications

### Local Docker

Zero additional infrastructure cost. Same containers, slightly more Postgres storage. Memory overhead of pgvector indexes scales linearly with total chunks across all projects, but even 10 projects with 1000 chunks each is trivial.

Connection overhead: each project database pool holds ~3 idle connections. 5 projects = ~15 idle connections. Postgres default `max_connections` is 100. Not a concern until 20+ projects.

### AWS Dev Environment

| Resource | 1 project | 5 projects | 10 projects |
|----------|-----------|------------|-------------|
| RDS storage | ~1 GB | ~3-5 GB | ~5-10 GB |
| RDS compute | Same (db.t4g.micro) | Same | Same |
| ElastiCache | Same | Same | Same |
| ECS tasks | Same | Same | Same |
| Embedding API (one-time) | ~$0.10 | ~$0.50 | ~$1.00 |
| Monthly infra | ~$30-50 | ~$30-50 | ~$35-55 |

Infrastructure cost doesn't scale with project count. Only embedding API calls scale (one-time per project's documents).

### AWS Prod Environment

Main consideration: vector index size. RDS `db.r6g.large` has 16GB RAM. Each 1024-dim vector ≈ 4KB. 10 projects × 10,000 chunks = 100K chunks ≈ 400MB of index. Well within the instance.

At 50+ projects with large document sets, consider Postgres declarative partitioning on the `document_chunks` table. That's an optimization, not an architecture change.

## Tradeoffs Acknowledged

**Migration management:** schema changes must run against each project database. Solvable with a loop script:
```bash
for db in $(psql -U postgres workbench -t -c "SELECT db_name FROM projects;"); do
  psql -U postgres "$db" -f migration.sql
done
```

**PostgREST:** connects to one database. Options: bypass PostgREST and use direct `pg` connections from the MCP server (recommended — the MCP server is already the API gateway), or run PostgREST per project (heavy, not recommended).

**Connection limits:** manageable up to ~20 projects on micro instances, ~50+ on production instances. Pool sizes should be kept small (2-3 connections per project).

## Implementation Estimate

| Layer | Scope | Effort |
|-------|-------|--------|
| Migration | `projects` registry table in `workbench` DB, script to create per-project DBs with existing migrations | ~50 lines SQL + 50 lines bash |
| API | Connection pool manager, project resolution middleware, updated Supabase client factory | ~200-300 lines TS changes |
| Portability | `.workbench/` directory logic, auto-backup on close, auto-restore on open | ~200 lines new code |
| CLI/Makefile | `make project`, `make backup-project`, `make drop-project`, `make list-projects` | ~100 lines |
