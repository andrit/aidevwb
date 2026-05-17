# Phase C Report — Loose Ends + Export/Ship Pipeline

## What Was Built

This phase closed two loose ends from Phase B and delivered the export/ship pipeline:

1. **Seed doc auto-ingestion** — seed docs are now ingested into the project knowledgebase automatically on project creation
2. **`.workbench/backup.sql.gz` auto-save/restore** — project databases auto-backup on server shutdown and auto-restore when a project is reopened on a new machine
3. **Export pipeline** — `make export-stack` generates a self-contained production stack from workbench infrastructure

## Loose End 1: Seed Doc Auto-Ingestion

### Before
The scaffold flow counted seed docs and reported "1 seed doc available — ingest with /ingest." The user had to manually ingest each one.

### After
Seed docs are automatically ingested into the project's knowledgebase immediately after the project database is created. The scaffold response now reports:

```json
{
  "seed_docs": { "ingested": 1, "errors": [] },
  "next_steps": ["1 seed doc(s) auto-ingested into the knowledgebase. Try /query to search them."]
}
```

On reconnect (project already exists), seed docs are NOT re-ingested — the SHA256 dedup handles this if the user manually re-ingests.

### Files Changed
- `src/services/scaffold.ts` — added `ingestSeedDocs()` function
- `src/routes/scaffold.ts` — calls `ingestSeedDocs()` after `createProject()`

## Loose End 2: Auto-Backup/Restore

### The Lifecycle

```
Project Open (new machine, empty DB)
  → checkAndRestore()
  → Finds .workbench/backup.sql.gz
  → Restores into the project database
  → Knowledgebase is back, no re-embedding needed

Server Shutdown (SIGTERM/SIGINT)
  → backupAllProjects()
  → pg_dump each project → .workbench/backup.sql.gz
  → Data survives container rebuilds and machine moves

Manual Backup/Restore
  → POST /projects/:name/backup
  → POST /projects/:name/restore
```

### What Gets Backed Up
The entire project database: documents, document_chunks (with embeddings), conversations, messages, memories, eval_runs. Everything in the project's PostgreSQL database, compressed with gzip.

### What Triggers Auto-Backup
- Server receives SIGTERM or SIGINT (graceful shutdown via `docker compose down` or `make down`)
- The shutdown handler iterates all registered projects and dumps each one to its `.workbench/` directory
- Failures are logged but don't block shutdown (non-fatal)

### What Triggers Auto-Restore
- `POST /scaffold` in reconnect mode (project already registered, `.workbench/` exists)
- The handler checks if the project database is empty (zero documents)
- If empty and `.workbench/backup.sql.gz` exists, auto-restores

### Files Created
- `src/services/lifecycle.ts` — `backupProject()`, `restoreProject()`, `checkAndRestore()`, `backupAllProjects()`

### Files Changed
- `src/index.ts` — shutdown handler calls `backupAllProjects()` before closing
- `src/routes/scaffold.ts` — reconnect mode calls `checkAndRestore()`, added `/projects/:name/backup` and `/projects/:name/restore` endpoints

## Phase C: Export Pipeline

### The Problem
You've built a RAG application in the workbench. It works. Now you need to deploy it independently. The workbench's Postgres, Redis, and API server are development infrastructure — your production app needs its own copies of these, configured for your project and free of workbench-specific code.

### What `make export-stack` Produces

```bash
make export-stack NAME=nexus FORMAT=compose
```

Generates inside the project directory:

```
~/code/nexus/
├── stack/                          ← GENERATED (new directory, never overwrites)
│   ├── docker-compose.yml          ← Postgres + Redis + API + Worker
│   ├── Dockerfile.api              ← Production API server
│   ├── Dockerfile.worker           ← Production RAG worker
│   ├── .env.example                ← Required environment variables
│   ├── README.md                   ← How to run the exported stack
│   ├── migrations/
│   │   ├── 001_extensions.sql
│   │   ├── 002_documents.sql
│   │   ├── 003_chunks.sql
│   │   ├── 004_hybrid_search.sql
│   │   ├── 005_conversations.sql
│   │   └── 006_memory_eval.sql
│   └── seed-data.sql.gz            ← (optional) database dump
```

### Three Export Formats

**compose** (default) — Docker Compose stack with Postgres (pgvector), Redis, API server, and RAG worker. Ready to `docker compose up` on any machine.

**terraform** — AWS infrastructure (VPC, RDS, ElastiCache, Secrets Manager) as a single-file Terraform module. Self-contained, no reference to the workbench's modular Terraform.

**migrations-only** — Just the SQL migration files. For projects that already have their own infrastructure and just need the database schema.

### Safety: Never Overwrites

If `stack/` already exists (from a previous export), the export creates `stack-2026-05-15T03-00-00/` instead. Existing files are never modified or deleted.

### Data Export

```bash
make export-with-data NAME=nexus
```

Includes `seed-data.sql.gz` — a pg_dump of the project's knowledgebase. Load it on production:

```bash
gunzip -c seed-data.sql.gz | docker exec -i nexus-db psql -U postgres -d nexus
```

### What Gets Exported vs What Stays Behind

| Exported | Not Exported |
|----------|-------------|
| Postgres schema (migrations) | Workbench registry database |
| Project database dump (optional) | MCP bridge / Claude Code integration |
| API server Dockerfile | Slash commands |
| Worker Dockerfile | `.workbench/` directory |
| docker-compose.yml | Multi-project routing |
| .env.example | Observability stack (Grafana/Tempo/OTel) |
| README | Scaffold/import logic |

The exported stack is a **fork point** — you own it completely and customize it for production. The workbench stays behind as a development tool.

## Files Created

### Services
| File | Purpose |
|------|---------|
| `src/services/export.ts` | Stack generation: render templates, copy migrations, dump data |
| `src/services/lifecycle.ts` | Auto-backup/restore for project portability |

### Routes
| File | Purpose |
|------|---------|
| `src/routes/export.ts` | `POST /projects/:name/export` |

### Schemas
| File | Purpose |
|------|---------|
| `src/schemas/export.ts` | ExportFormatSchema, ExportStackSchema, ExportResultSchema |

### Tests
| File | Tests |
|------|-------|
| `src/__tests__/schemas/export.test.ts` | 5 tests — format validation, defaults, options |

### Export Templates (6 files)
| File | Purpose |
|------|---------|
| `templates/_export/compose/docker-compose.yml` | Production compose with {{PROJECT_NAME}} variables |
| `templates/_export/compose/Dockerfile.api` | API server multi-stage build |
| `templates/_export/compose/Dockerfile.worker` | RAG worker image |
| `templates/_export/compose/env.example` | Production .env template |
| `templates/_export/compose/README.md` | How to run the exported stack |
| `templates/_export/terraform/main.tf` | Single-file AWS infrastructure |

## Test Results

```
 ✓ src/__tests__/schemas/schemas.test.ts (19 tests)
 ✓ src/__tests__/schemas/phase2-schemas.test.ts (20 tests)
 ✓ src/__tests__/lib/chunker.test.ts (11 tests)
 ✓ src/__tests__/lib/templates.test.ts (15 tests)
 ✓ src/__tests__/schemas/export.test.ts (5 tests)
 ✓ src/__tests__/lib/hash.test.ts (5 tests)
 ✓ src/__tests__/services/conversations.test.ts (4 tests)

 Test Files  7 passed (7)
      Tests  79 passed (79)
```

## User Interfaces

### Makefile

```bash
make export-stack NAME=nexus                    # Docker Compose (default)
make export-stack NAME=nexus FORMAT=terraform   # AWS Terraform
make export-stack NAME=nexus FORMAT=migrations-only  # SQL only
make export-with-data NAME=nexus                # Compose + database dump
```

### REST API

```bash
# Export with defaults (compose, no data)
POST /projects/nexus/export
{}

# Export with options
POST /projects/nexus/export
{"format": "terraform", "include_data": true}

# Manual backup/restore
POST /projects/nexus/backup
POST /projects/nexus/restore
```

### Response

```json
{
  "format": "compose",
  "output_dir": "/home/user/code/nexus/stack",
  "files_created": [
    "docker-compose.yml", "Dockerfile.api", "Dockerfile.worker",
    ".env.example", "README.md",
    "migrations/001_extensions.sql", "migrations/002_documents.sql",
    "migrations/003_chunks.sql", "migrations/004_hybrid_search.sql",
    "migrations/005_conversations.sql", "migrations/006_memory_eval.sql"
  ],
  "data_exported": false
}
```

## The Full Project Lifecycle

```
make scaffold NAME=nexus TYPE=rag
  → scaffold directory, create DB, auto-ingest seed docs

WORKBENCH_PROJECT=nexus make claude
  → develop with Claude Code, /ingest docs, /query, /test, /eval

make export-stack NAME=nexus
  → generate stack/ with production infrastructure

cd ~/code/nexus/stack && docker compose up -d
  → running independently, workbench not involved

make down
  → auto-backup all project databases to .workbench/

# New machine:
make init && make project NAME=nexus DIR=~/code/nexus
  → auto-restore from .workbench/backup.sql.gz
```

## What's Next

The three build phases (1, 2, B, C) plus loose ends are complete. The workbench now covers the full lifecycle from project creation to production export. Remaining items from the roadmap:

- **Phase 3A (Agent Platform):** Agent scaffold with framework templates, agent trace viewer, multi-agent orchestration
- **Template expansion:** More seed docs per project type, starter code in scaffold templates
- **OTel instrumentation:** Add actual tracing to the MCP server and worker services (infrastructure is ready, code instrumentation is not)
