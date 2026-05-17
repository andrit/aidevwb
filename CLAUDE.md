# AI Dev Workbench

## What This Is
A portable, Docker-based AI development environment with opt-in RAG/MCP capabilities.
Everything runs inside Docker — your host machine only needs Docker installed.
Zero trust policy: the host stays clean, all tools and runtimes live in containers.

## Architecture
- **Orchestration**: TypeScript + Fastify + Zod (MCP server at :3100)
- **AI/ML Workers**: Python scripts (lean, no framework, RAG-Anything for multimodal)
- **Database**: Self-hosted Supabase (PostgreSQL + pgvector + tsvector hybrid search)
- **Queue**: Redis + BullMQ for async ingestion jobs
- **LLM**: Claude via Anthropic SDK (direct, no proxy)
- **Embeddings**: OpenRouter proxy → configurable model (default: Voyage voyage-3, 1024 dims)
- **Observability**: OpenTelemetry + Tempo + Grafana (traces at :3200)
- **Optional**: Neo4j for GraphRAG (compose profile: neo4j)

## Services (Docker Compose)
| Service         | Container        | Port  | Purpose                          |
|-----------------|------------------|-------|----------------------------------|
| claude-code     | claude-code      | —     | Interactive Claude Code CLI      |
| mcp-server      | mcp-server       | 3100  | REST API + MCP bridge (TS)       |
| rag-worker      | rag-worker       | —     | Python ingestion workers         |
| supabase-db     | supabase-db      | 5432  | PostgreSQL + pgvector            |
| supabase-rest   | supabase-rest    | —     | PostgREST                        |
| supabase-kong   | supabase-kong    | 8000  | API gateway                      |
| redis           | redis            | 6379  | Job queue + cache                |
| otel-collector  | otel-collector   | 4318  | Trace collection                 |
| tempo           | tempo            | —     | Trace storage                    |
| grafana         | grafana          | 3200  | Dashboards                       |

## Environment Variables (in .env, never committed)
- ANTHROPIC_API_KEY — Claude LLM + Claude Code auth
- OPENROUTER_API_KEY — embedding model access (proxy)
- POSTGRES_PASSWORD — self-hosted Supabase database
- JWT_SECRET — Supabase auth JWT signing
- EMBEDDING_MODEL — current embedding model (swap here)
- EMBEDDING_DIMENSIONS — must match model output

## Slash Commands
- /ingest <filepath> — ingest a document (skips if SHA256 unchanged)
- /query <question> — hybrid search + Claude answer generation
- /status — show knowledgebase stats, queue depth, model info
- /reindex — force re-embed all documents (after model change)

## MCP Tools Available
These tools are provided by the workbench MCP bridge (`/opt/mcp-bridge/index.js`).
The bridge is registered via `claude mcp add workbench -- node /opt/mcp-bridge/index.js`.
If tools are not responding, re-register: `make register-mcp` from the host.

- `rag_ingest` — ingest documents (text inline, multimodal queued)
- `rag_query` — hybrid search + answer generation
- `rag_status` — knowledgebase statistics
- `rag_reindex` — re-embed everything (requires confirm: true)

## Key Design Decisions
- TypeScript owns orchestration; Python handles ML/embedding workloads
- Zod schemas are the single source of truth for tool definitions
- SHA256 content hashing skips unchanged files (saves embed costs)
- Hybrid search: 70% cosine similarity + 30% ts_rank keyword matching
- HTTP API is the primary interface; MCP bridge is a thin stdio↔HTTP wrapper
- Self-hosted Supabase for full local reproducibility (no cloud dependency)

## Critical Rule: Never Overwrite Project Files
When the workbench interacts with an existing project directory (import, export, scaffold),
it must NEVER overwrite files that already exist. This is especially important for CLAUDE.md,
which the developer has tailored to their project. The workbench may:
- Create new files in .workbench/ (always safe — that directory is ours)
- OFFER to append clearly-delimited sections to existing files (with user confirmation)
- Write seed docs to the database (never to the project directory)
Two modes: `make scaffold` (new project, write everything) vs `make project` (existing project,
append-only). See docs/11-project-types-and-affordances.md "Import vs New" for full spec.

## Embedding Model Swap Process
1. Edit .env: EMBEDDING_MODEL + EMBEDDING_DIMENSIONS
2. If dimensions changed: ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(N)
3. Update hybrid_search() function if dimensions changed
4. docker compose down && docker compose up -d
5. Run /reindex

## File Structure
```
ai-dev-workbench/
├── docker-compose.yml           # All services
├── .env                         # Secrets (never committed)
├── CLAUDE.md                    # This file
├── Makefile                     # One-command operations
├── apps/
│   ├── mcp-server/              # TypeScript + Fastify + Zod
│   ├── rag-worker/              # Python ingestion scripts
│   └── claude-code/             # Claude Code container
├── configs/
│   ├── claude/commands/         # Slash commands
│   ├── mcp/bridge/              # MCP stdio↔HTTP bridge (plain JS)
│   ├── mcp/mcp-servers.json     # Declarative MCP config
│   ├── supabase/                # Kong gateway config
│   ├── otel/                    # Tracing config
│   └── grafana/                 # Dashboard config
├── supabase/migrations/         # Database schema (auto-runs on boot)
├── backups/                     # Database dumps (tracked in git)
├── docs/                        # Operational docs (smoke test, etc.)
├── documents/                   # Source documents for RAG
├── infra/scripts/               # bootstrap, backup, restore, register-mcp, deploy
├── infra/terraform/             # Cloud provisioning (AWS)
│   ├── modules/                 # networking, database, redis, containers, secrets
│   └── environments/            # dev/ and prod/ root modules
```

## Cloud Deployment (Terraform)
When you need to move beyond local Docker:
- `make tf-init-dev` → `make tf-plan-dev` → `make tf-apply-dev` — provision AWS infrastructure
- `make deploy-dev` — build images, push to ECR, update ECS services, run migrations
- Modules map 1:1 to Docker Compose services (supabase-db → RDS, redis → ElastiCache, etc.)
- See `infra/terraform/README.md` for full documentation

## Moving Between Workstations
The repo directory contains everything except database state. To move:

1. **Before leaving the old machine:**
   - `make backup` — dumps all documents, chunks, and embeddings to `backups/`
   - Commit or copy the repo directory (including `backups/`)

2. **On the new machine:**
   - Copy/clone the repo, fill in `.env` with your API keys
   - `make init` — builds and starts all containers
   - `make restore` — loads the database backup
   - `make claude` — resume working

What travels with the repo: all code, config, migrations, source documents, database backups.
What doesn't: Docker volumes (recreated on `make init`), Claude Code auth (re-authenticate once).

