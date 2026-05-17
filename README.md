# AI Dev Workbench

A portable, Docker-based development environment with opt-in RAG and MCP capabilities. Everything runs in containers — your host machine stays clean. Point it at any project directory, spin up, and start building with Claude Code backed by a full-stack AI toolkit: hybrid search, document ingestion, async job processing, and distributed tracing.

The RAG/MCP tools are there when you need them and invisible when you don't. At its core this is a reproducible, isolated dev environment that happens to ship with an AI-powered knowledgebase.

## Prerequisites

- **Docker Desktop** (or Docker Engine + Compose v2) — the only host dependency
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)
- **OpenRouter API key** — [openrouter.ai/settings](https://openrouter.ai/settings) (for embedding model access)

That's it. No Node.js, no Python, no PostgreSQL on your host.

## Quick Start

```bash
# 1. Clone and enter
git clone <your-repo-url> ai-dev-workbench
cd ai-dev-workbench

# 2. First run creates .env from template — fill in your keys
make init
# → Edit .env with your API keys, then re-run:
make init

# 3. Start Claude Code
make claude
```

`make init` handles everything: validates your `.env`, builds containers, starts the stack, waits for health checks, and registers the MCP bridge with Claude Code. On first launch, Claude Code will prompt you to authenticate via browser — the token persists across rebuilds.

Once you're inside Claude Code, the workbench tools are available immediately:

```
> /status                              # Check knowledgebase state
> /ingest documents/handbook.pdf       # Add a document
> /query What is the refund policy?    # Search and answer
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Host Machine                                                 │
│  └── ai-dev-workbench/                                        │
│      ├── .env (secrets)                                       │
│      ├── documents/ (source files for RAG)                    │
│      ├── workspace/ (your project files)                      │
│      └── backups/ (database dumps)                            │
│                                                               │
│  Docker Network: workbench-network                            │
│  ┌─────────────┐  stdio   ┌──────────────┐  HTTP   ┌───────┐│
│  │ claude-code  │ ──MCP──▸ │  mcp-server  │ ◂─────▸ │ redis ││
│  │ (Claude CLI) │          │ (Fastify+Zod)│         │(queue)││
│  └─────────────┘          └──────┬───────┘         └───────┘│
│                                   │                           │
│                          ┌────────┴────────┐                  │
│                          ▼                 ▼                  │
│                   ┌────────────┐    ┌────────────┐            │
│                   │ supabase   │    │ rag-worker │            │
│                   │ (pgvector) │    │  (Python)  │            │
│                   └────────────┘    └────────────┘            │
│                                                               │
│  Observability: otel-collector → tempo → grafana (:3200)      │
│  Optional: neo4j (:7474), supabase-studio (:3001)             │
└──────────────────────────────────────────────────────────────┘
```

**Orchestration layer** (TypeScript + Fastify + Zod): handles all API routing, request validation, MCP tool definitions, and coordination. Zod schemas are the single source of truth — they generate JSON Schema for MCP, validate HTTP requests, and infer TypeScript types.

**Worker layer** (Python, no framework): lean scripts for embedding, chunking, and multimodal document processing via RAG-Anything. Text files are processed inline by the TS layer; PDFs and images are queued to the Python worker via BullMQ/Redis.

**Database** (self-hosted Supabase): PostgreSQL with pgvector for cosine similarity search and tsvector for full-text keyword search. Hybrid search combines both (default: 70% vector, 30% keyword).

**LLM routing**: Claude via Anthropic SDK (direct, lowest latency). Embeddings via OpenRouter (swap models with one env var change).

## Pointing at a Project

By default the workbench mounts `./workspace/` as `/workspace` inside Claude Code. To point it at an existing project:

```bash
# Option 1: Set in .env (persistent)
PROJECT_DIR=/path/to/your/project

# Option 2: Override on the fly
PROJECT_DIR=~/code/my-app docker compose up -d
```

Your project files appear at `/workspace/` inside the container. The `documents/` directory is always available at `/workspace/documents/` regardless of `PROJECT_DIR` — it's a separate mount for RAG source files.

## Daily Workflow

**Start your day:**
```bash
make up          # Start the stack (if not running)
make claude      # Enter Claude Code
```

**Inside Claude Code:**
```
> /status                                 # Quick health check
> Help me refactor the auth module        # Normal coding — no RAG needed
> /ingest documents/api-spec.yaml         # Add a doc to the knowledgebase
> /query What endpoints require auth?     # Ask questions across all docs
```

**From the host (parallel terminal):**
```bash
make status          # Service health + RAG stats
make logs-mcp        # Watch MCP server logs
make test-health     # Quick API ping
```

**End your day:**
```bash
make backup          # Snapshot the database (optional but recommended)
make down            # Stop everything (volumes preserved)
```

## RAG Operations

### Ingesting Documents

Drop files into the `documents/` directory, then ingest from Claude Code:

```
> /ingest documents/handbook.pdf
```

The system automatically:
- Computes a SHA256 hash of the file content
- Skips re-ingestion if the hash matches an existing document
- For text files: chunks, embeds, and stores inline (fast)
- For PDFs/images: queues to the Python worker for multimodal processing via RAG-Anything

Supported file types: `.txt`, `.md`, `.json`, `.csv`, `.yaml`, `.xml` (inline), `.pdf`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.tiff` (queued to worker).

### Querying

```
> /query What are the main risk factors mentioned in the Q3 report?
```

Hybrid search retrieves the most relevant chunks using both semantic similarity (vector cosine distance) and keyword matching (PostgreSQL full-text search), then Claude generates an answer citing the retrieved context.

### Changing Embedding Models

The embedding model is configured via environment variables. To swap:

1. Edit `.env`:
   ```
   EMBEDDING_MODEL=openai/text-embedding-3-small
   EMBEDDING_DIMENSIONS=1536
   ```

2. If dimensions changed, update the database:
   ```bash
   make db-shell
   ```
   ```sql
   ALTER TABLE document_chunks
     ALTER COLUMN embedding TYPE vector(1536);
   -- Then recreate hybrid_search() with vector(1536) parameter
   ```

3. Restart and reindex:
   ```bash
   docker compose down && docker compose up -d
   ```
   Then in Claude Code: `/reindex`

Available models via OpenRouter (non-exhaustive):

| Model | Dimensions | Cost/M tokens |
|-------|-----------|---------------|
| `voyage/voyage-3` (default) | 1024 | $0.06 |
| `openai/text-embedding-3-small` | 1536 | $0.02 |
| `google/gemini-embedding-2` | 768 | $0.20 |
| `baai/bge-m3` | 1024 | $0.01 |

## Observability

Grafana is available at [http://localhost:3200](http://localhost:3200) (default login: admin/admin).

All workbench services emit OpenTelemetry traces. The pipeline: your services → OTel Collector (:4318) → Tempo → Grafana. This lets you see request flows, latencies, and errors across the MCP server, RAG worker, and database.

This infrastructure isn't locked to the workbench — any project you build inside the environment can emit traces to the same collector. Add a few lines of OTel instrumentation to your app and your traces appear in the same Grafana dashboards.

## Optional Services

```bash
make studio      # Supabase Studio at :3001 — visual DB management
make neo4j       # Neo4j at :7474 — graph database for GraphRAG
make all         # Everything
```

These are Docker Compose profiles. They don't start by default and consume no resources until activated.

## Moving Between Machines

The repo directory contains everything except database state (which lives in Docker volumes).

**Before leaving:**
```bash
make backup      # Dumps all RAG data to backups/
git add -A && git commit -m "workstation snapshot"
```

**On the new machine:**
```bash
git clone <repo> && cd ai-dev-workbench
# Fill in .env with your API keys
make init        # Build + start + register MCP
make restore     # Load the database backup
make claude      # Resume working
```

No re-embedding, no API costs. The backup contains all documents, chunks, and vector embeddings.

## Make Targets

```
  init            First-time setup: env → build → start → MCP registration
  register-mcp    Re-register MCP bridge with Claude Code
  up              Start all core services
  down            Stop all services (preserves volumes)
  build           Build/rebuild all containers
  clean           Stop and remove everything including volumes
  claude          Attach to Claude Code interactive session
  claude-cmd      Run a one-shot command (make claude-cmd CMD="your prompt")
  studio          Start with Supabase Studio (web UI at :3001)
  neo4j           Start with Neo4j (browser at :7474)
  all             Start everything including all optional services
  status          Show service status and RAG stats
  logs            Tail logs from all services
  logs-mcp        Tail MCP server logs
  logs-worker     Tail RAG worker logs
  db-shell        Open psql shell in Supabase database
  backup          Backup database to backups/
  restore         Restore database from backup
  test-health     Test API health endpoint
  test-ingest     Test ingestion with sample document
  test-query      Test query (make test-query Q="your question")
  smoke-test      Run automated smoke test checks
  deploy-dev      Deploy to AWS dev (build + push + update ECS)
  deploy-prod     Deploy to AWS prod
  tf-init-dev     Initialize Terraform for dev environment
  tf-plan-dev     Preview Terraform changes for dev
  tf-apply-dev    Apply Terraform changes for dev
  tf-destroy-dev  Tear down dev cloud infrastructure
```

## Cloud Deployment

The workbench can be deployed to AWS when you need persistent hosting, team access, or production use. The Terraform modules in `infra/terraform/` map 1:1 to the local Docker Compose services:

| Local (Compose) | Cloud (Terraform) | Module |
|-----------------|-------------------|--------|
| supabase-db | AWS RDS PostgreSQL + pgvector | `database` |
| redis | AWS ElastiCache Redis | `redis` |
| mcp-server, rag-worker | AWS ECS Fargate | `containers` |
| workbench-network | AWS VPC + private subnets | `networking` |
| .env | AWS Secrets Manager | `secrets` |

Two environments are provided: `dev` (single-AZ, micro instances) and `prod` (multi-AZ, production-grade sizing).

```bash
# 1. Provision infrastructure
cd infra/terraform/environments/dev
cp terraform.tfvars.example terraform.tfvars
# Fill in API keys and passwords
terraform init && terraform apply

# 2. Build and deploy containers
make deploy-dev
```

See `infra/terraform/README.md` for full documentation.

## Extending the Workbench

### Adding a New MCP Tool

1. Define the Zod schema in `apps/mcp-server/src/schemas/index.ts`
2. Implement the service logic in `apps/mcp-server/src/services/`
3. Add a Fastify route in `apps/mcp-server/src/routes/index.ts`
4. Add the tool to the MCP bridge in `configs/mcp/bridge/index.js`
5. Optionally add a slash command in `configs/claude/commands/`

The Zod schema flows through every layer: it validates the HTTP request, generates the MCP tool definition (via `zodToJsonSchema`), and infers the TypeScript type.

### Adding a Python Worker Script

Drop a new script in `apps/rag-worker/scripts/`. It can be called directly:
```bash
docker exec -it rag-worker python scripts/your_script.py
```

Or add a new BullMQ queue/job type in `apps/rag-worker/lib/worker.py` and enqueue from the TS layer.

### Adding a New Service

Add it to `docker-compose.yml` on the `workbench` network. If it should be optional, use a compose profile. The OTel Collector at `:4318` accepts traces from any service on the network.

## Troubleshooting

**MCP tools not responding in Claude Code:**
```bash
make register-mcp    # Re-register the bridge
# Or inside Claude Code:
# claude mcp list     — verify workbench is listed
# claude mcp remove workbench && claude mcp add workbench -s user -- node /opt/mcp-bridge/index.js
```

**Services won't start:**
```bash
make logs            # Check for errors
docker compose ps    # Check health status
make clean && make init  # Nuclear option: rebuild everything
```

**Database migration didn't run:**
```bash
make db-shell
# Check if tables exist:
\dt
# If not, migrations may have failed on boot. Check:
docker compose logs supabase-db | head -50
```

**Ingestion stuck / queue not draining:**
```bash
make logs-worker     # Check Python worker logs
docker exec redis redis-cli LLEN bull:ingest:wait   # Queue depth
docker exec -it rag-worker python scripts/ingest.py /workspace/documents/file.txt  # Manual run
```

**Port conflicts:**
Edit `.env` to change the API port: `API_PORT=3101`. Grafana, Supabase, and other ports can be changed directly in `docker-compose.yml`.
