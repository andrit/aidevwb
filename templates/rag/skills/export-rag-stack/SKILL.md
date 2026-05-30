---
name: export-rag-stack
description: Export a RAG project to a standalone production stack — Docker Compose or Terraform, verify migrations and embeddings survive export, seed the production knowledgebase, and smoke-test before going live
domain: rag
type: rag
triggers:
  - "export RAG to production"
  - "deploy the RAG app"
  - "go live with RAG"
  - "production RAG stack"
  - "export stack"
  - "ship the knowledgebase"
  - "deploy knowledgebase"
  - "production search"
  - "make RAG standalone"
---

# Export RAG Stack to Production

## When to use

When a RAG application built in the workbench is ready to run in production without the workbench nearby. The workbench provides Postgres, Redis, the embedding worker, and the MCP server during development — the exported stack replaces all of these. Activate when the user says "deploy the RAG app", "export to production", or "make it standalone."

## Prerequisites

- RAG application working in workbench with acceptable eval scores (MRR ≥ 0.7, pass rate ≥ 75%)
- `make export-stack NAME=<project> FORMAT=compose` or `FORMAT=terraform` succeeds
- Documents available for seeding production (or a backup from the workbench project)
- Production server or cloud account with Docker or Kubernetes
- `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` (or equivalent) available for production

## What the Export Pipeline Does

The workbench export (`make export-stack`) generates a standalone stack that includes:
- A Fastify API server (the MCP server's routes, minus the workbench tooling)
- A Python RAG worker (identical to the one in `apps/rag-worker/`)
- PostgreSQL with pgvector — owns all documents, chunks, and memories
- Redis — job queue for the ingestion pipeline
- Nginx — reverse proxy + TLS termination (Compose format)

**What it does NOT include:**
- Grafana, Tempo, OTel collector (add these separately if needed)
- The MCP bridge (production doesn't use MCP — it uses the HTTP API directly)
- Any hardcoded workbench URLs (the export resolves all to env vars)

## Steps

### 1. Run a final eval before exporting

Before exporting, confirm you're exporting a working knowledgebase:

```bash
/eval baseline-v1
```

Take note of the MRR and pass rate. If either has dropped since your last tuning session, investigate before exporting.

### 2. Backup the workbench project

The backup includes documents metadata, chunk vectors, memories, and eval history:

```bash
make backup-project NAME=<project>
# Creates .workbench/<project>-backup-<timestamp>.sql.gz
```

This backup is what you'll use to seed production. Keep it.

### 3. Generate the export

```bash
make export-stack NAME=<project> FORMAT=compose
```

Output goes to `.workbench/export/<project>/`. Structure:

```
.workbench/export/<project>/
├── docker-compose.yml        — production Compose stack
├── api/
│   ├── Dockerfile
│   └── src/                  — API server (no workbench tooling)
├── worker/
│   ├── Dockerfile
│   └── lib/                  — RAG worker
├── nginx/
│   └── nginx.conf
├── migrations/               — SQL migrations to run on first deploy
├── .env.example              — all required env vars with descriptions
└── README.md                 — deployment instructions
```

For Terraform (cloud deployment):

```bash
make export-stack NAME=<project> FORMAT=terraform
# Adds terraform/ directory with ECS/RDS modules
```

### 4. Review and complete the .env

The `.env.example` lists every required variable. Fill in production values:

```bash
# .workbench/export/<project>/.env.example
ANTHROPIC_API_KEY=          # required — Claude API key for query answering
OPENROUTER_API_KEY=         # required — embedding model access
EMBEDDING_MODEL=voyage/voyage-3   # must match what was used during dev ingestion
EMBEDDING_DIMENSIONS=1024          # must match EMBEDDING_MODEL
POSTGRES_PASSWORD=          # generate: openssl rand -base64 32
VECTOR_WEIGHT=0.7            # copy from your tuned workbench .env
TEXT_WEIGHT=0.3              # copy from your tuned workbench .env
CHUNK_SIZE=500               # copy from your workbench .env
CHUNK_OVERLAP=50             # copy from your workbench .env
PORT=3000
LOG_LEVEL=info
```

**Critical:** `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` must be identical to what was used during development. If they differ, the production vectors and query vectors will be in different spaces — search will silently return wrong results.

Store production values in a secrets manager (AWS SSM, Doppler, Vault), not in a `.env` file committed to git.

### 5. Test the export locally before deploying

Before pushing to production, run the exported stack on your local machine:

```bash
cd .workbench/export/<project>
cp .env.example .env  # fill in test values
docker compose up -d

# Wait for services to start
sleep 10

# Run health checks
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
# Both should return {"status":"ok"}
```

### 6. Verify migrations run correctly

The migrations must run on the fresh production Postgres before ingesting anything:

```bash
# In the exported stack, migrations run automatically on first API startup
# Verify by checking the documents table exists:
docker compose exec postgres psql -U postgres -d <project> \
  -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';"
# Should show: documents, document_chunks, memories, conversations, eval_runs
```

If the API container starts but the DB tables don't exist, the migrations failed — check API container logs:

```bash
docker compose logs api | grep -E "migration|error|ERROR"
```

### 7. Seed production with your corpus

**Option A: Re-ingest from source files** (preferred — ensures clean production state)

```bash
# Ingest all documents from your source directory into the exported stack
WORKBENCH_PROJECT=<project>
for f in $(find /your/docs -type f \( -name "*.md" -o -name "*.pdf" \)); do
  curl -s -X POST http://localhost:3000/ingest \
    -H "Content-Type: application/json" \
    -H "X-Project: <project>" \
    -d "{\"filepath\": \"$f\"}"
done
# Wait for queue to drain
until [ "$(curl -s http://localhost:3000/status -H "X-Project: <project>" | jq .queue_waiting)" -eq 0 ]; do
  sleep 5; echo "waiting..."
done
```

**Option B: Restore from workbench backup** (faster for large corpora)

```bash
# Restore the backup SQL into the production Postgres
gunzip -c .workbench/<project>-backup-<timestamp>.sql.gz | \
  docker compose exec -T postgres psql -U postgres -d <project>
```

Note: a backup restore also brings over the embedding vectors — only use this if production uses **identical** `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` as the workbench. If they differ, re-ingest instead.

### 8. Run the smoke test against the exported stack

```bash
# scripts/rag-smoke-test.sh — verify exported stack works end to end
#!/bin/bash
set -e
BASE_URL="${1:-http://localhost:3000}"
PROJECT="${2:-<project>}"

echo "=== RAG Stack Smoke Tests ==="

echo "[1] Health live..."
curl -sf "$BASE_URL/health/live" | grep -q '"status":"ok"'
echo "  ✓"

echo "[2] Health ready (checks DB + Redis)..."
curl -sf "$BASE_URL/health/ready" \
  -H "X-Project: $PROJECT" | grep -q '"status":"ok"'
echo "  ✓"

echo "[3] Status shows documents ingested..."
DOCS=$(curl -sf "$BASE_URL/status" -H "X-Project: $PROJECT" | jq .total_documents)
[ "$DOCS" -gt 0 ] && echo "  ✓ $DOCS documents" || (echo "  ✗ No documents"; exit 1)

echo "[4] Query returns a result..."
ANSWER=$(curl -sf -X POST "$BASE_URL/query" \
  -H "Content-Type: application/json" \
  -H "X-Project: $PROJECT" \
  -d '{"question": "<a question you know the answer to>", "top_k": 3}')
echo "$ANSWER" | jq -e '.answer' > /dev/null && echo "  ✓ Query returned answer" || (echo "  ✗ No answer"; exit 1)

echo ""
echo "=== All smoke tests passed ==="
```

```bash
bash scripts/rag-smoke-test.sh http://localhost:3000 <project>
```

### 9. Run the eval set against production

The final validation: run your eval set against the production stack to confirm scores match development:

```bash
# Run baseline eval against production
curl -s -X POST http://localhost:3000/eval \
  -H "Content-Type: application/json" \
  -H "X-Project: <project>" \
  -d @evals/baseline.json | \
  jq '{mrr, avg_top_score, passed, total_queries}'
```

The production MRR should be within ±0.05 of the development baseline. A bigger drop indicates:
- Wrong embedding model or dimensions (re-check `.env`)
- Documents seeded incorrectly (chunk count in status differs from workbench)
- Vector weight settings don't match development

### 10. Deploy to production server

For Docker Compose deployment on a VPS/VM:

```bash
# On the production server
git clone <your-repo> or scp the export directory
cd <project>
# Fill in .env with production secrets (from secrets manager)
docker compose up -d

# Run the smoke test against the production URL
bash scripts/rag-smoke-test.sh https://api.example.com <project>
```

For Terraform (cloud):

```bash
cd .workbench/export/<project>/terraform/environments/production
terraform init
terraform plan
terraform apply
# Then seed using Option A (re-ingest from source files)
```

## Production Configuration Checklist

Before going live:

```bash
# Verify embedding model matches development
curl http://localhost:3000/status -H "X-Project: <project>" | jq .embedding_model
# Must match: "voyage/voyage-3" (or whatever you used in dev)

# Verify chunk count matches development (within 5% — duplicates are normal)
# dev:  total_chunks: 2400
# prod: total_chunks: 2380  ← acceptable (some boundary chunks differ)
# prod: total_chunks: 400   ← NOT acceptable — ingestion failed

# Verify /health/ready checks dependencies
curl http://localhost:3000/health/ready -H "X-Project: <project>"
# {"status":"ok","db":"connected","redis":"connected"}
```

## Checklist

- [ ] Final eval run before export — MRR and pass rate at target
- [ ] Backup created: `make backup-project NAME=<project>`
- [ ] Export generated: `make export-stack NAME=<project> FORMAT=compose`
- [ ] All env vars filled in from workbench `.env` (matching `EMBEDDING_MODEL`, `VECTOR_WEIGHT`, etc.)
- [ ] Exported stack tested locally: health endpoints return OK
- [ ] Migrations ran: all expected tables exist in production Postgres
- [ ] Corpus seeded (re-ingest or backup restore)
- [ ] Chunk count in production within 5% of development count
- [ ] Smoke test script passes against local exported stack
- [ ] Eval set run against exported stack — MRR within ±0.05 of development baseline
- [ ] Secrets in secrets manager (not in `.env` file committed to git)

## Files involved

| File | Action |
|------|--------|
| `.workbench/export/<project>/` | Generated by `make export-stack` |
| `.workbench/<project>-backup-*.sql.gz` | Created by `make backup-project` |
| `scripts/rag-smoke-test.sh` | Create: smoke test script for exported stack |
| `evals/baseline.json` | Use: run against production to validate scores |

## Common mistakes

**Different embedding model in production** — if dev used `voyage/voyage-3` and production uses `openai/text-embedding-3-small`, the stored vectors and query vectors are in incompatible spaces. Queries will silently return wrong results with plausible-looking scores. The embedding model must be identical between development and production.

**Restoring backup when model changed** — a backup restore brings over the old embedding vectors. If the production `EMBEDDING_MODEL` differs from dev, you must re-ingest from source files — the backed-up vectors are useless.

**Not running eval against production** — smoke tests verify the stack is alive. The eval set verifies it's returning the right content. Both are required. A stack that passes health checks but has wrong vectors or wrong weights will fail the eval.

**Workbench env vars in production** — `WORKBENCH_API=http://mcp-server:3100` is a Docker network hostname that doesn't exist in production. The export pipeline replaces these, but verify no workbench hostnames appear in the exported config.

**Forgetting to set VECTOR_WEIGHT/TEXT_WEIGHT** — if you tuned the weights in development (e.g., to 0.8/0.2) but production uses the defaults (0.7/0.3), the quality difference will be real and confusing. Copy every tuned value from the workbench `.env` to production.
