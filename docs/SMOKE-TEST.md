# AI Dev Workbench — Full Smoke Test

Run this end-to-end after a fresh clone, after major changes, or on a new machine.
Every step includes the exact command, expected output, and failure triage.

Estimated time: 15–20 minutes (first run with image pulls), 5–10 minutes on rebuilds.

---

## Prerequisites

Before starting, confirm:

```bash
# Docker is running and compose v2 is available
docker --version
# Expected: Docker version 24+ or 27+

docker compose version
# Expected: Docker Compose version v2.x.x

# No port conflicts on the host
# Core:     3100 (API), 5432 (Postgres), 6379 (Redis), 8000 (Supabase gateway)
# Observe:  3200 (Grafana), 4318 (OTel)
# Optional: 3001 (Studio), 7474/7687 (Neo4j)
for port in 3100 5432 6379 8000 3200 4318; do
  lsof -i :$port > /dev/null 2>&1 && echo "⚠️  Port $port in use" || echo "✅ Port $port free"
done
```

---

## Phase 1: Environment Setup

### 1.1 — Create and validate .env

```bash
cp .env.example .env
```

Open `.env` and set these four values (everything else has working defaults):

```
ANTHROPIC_API_KEY=sk-ant-...     ← your real key
OPENROUTER_API_KEY=sk-or-...     ← your real key
POSTGRES_PASSWORD=smoketest123   ← any strong password
JWT_SECRET=super-secret-jwt-key-must-be-at-least-32-characters-long
```

**Verify:**

```bash
source .env
echo "Anthropic: ${ANTHROPIC_API_KEY:0:10}..."
echo "OpenRouter: ${OPENROUTER_API_KEY:0:10}..."
echo "Postgres: ${POSTGRES_PASSWORD}"
echo "JWT: ${JWT_SECRET:0:20}..."
```

**Expected:** All four values printed (not placeholders).

**If it fails:** You're still using template values. The bootstrap script will also catch this, but fix it now to save time.

---

## Phase 2: Build

### 2.1 — Build all container images

```bash
docker compose build --parallel 2>&1 | tee docs/smoke-build.log
```

**Expected:** Three custom images build successfully:
- `claude-code` — pulls `ghcr.io/anthropics/claude-code:latest`, installs Python + MCP bridge
- `mcp-server` — multi-stage Node build, TypeScript compilation, production deps
- `rag-worker` — Python 3.12, system libs (tesseract, poppler), pip install

**Watch for:**
- `npm run build` (tsc) must complete without errors in mcp-server stage
- `npm install` inside claude-code Dockerfile for the MCP bridge
- `pip install` in rag-worker for all Python deps

**If it fails:**
- Network errors → check Docker's DNS and proxy settings
- `tsc` errors → run `cd apps/mcp-server && npm install && npx tsc --noEmit` locally
- `pip install` errors → check `apps/rag-worker/requirements.txt` for version conflicts

---

## Phase 3: Container Startup

### 3.1 — Start core services

```bash
docker compose up -d
```

### 3.2 — Wait for health checks

```bash
echo "Waiting for services to become healthy..."
timeout=120
elapsed=0
while [ $elapsed -lt $timeout ]; do
  healthy=$(docker compose ps --format json | grep -c '"healthy"' 2>/dev/null || echo 0)
  echo "  ${elapsed}s — ${healthy}/3 healthy (need: supabase-db, redis, mcp-server)"
  [ "$healthy" -ge 3 ] && break
  sleep 10
  elapsed=$((elapsed + 10))
done
```

**Expected:** 3 healthy services within ~60 seconds.

### 3.3 — Verify all containers are running

```bash
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
```

**Expected output (10 core containers):**

```
NAME               STATUS                    PORTS
claude-code        Up (healthy)              
grafana            Up                        0.0.0.0:3200->3000/tcp
mcp-server         Up (healthy)              0.0.0.0:3100->3100/tcp
otel-collector     Up                        0.0.0.0:4318->4318/tcp
rag-worker         Up
redis              Up (healthy)              0.0.0.0:6379->6379/tcp
supabase-db        Up (healthy)              0.0.0.0:5432->5432/tcp
supabase-kong      Up                        0.0.0.0:8000->8000/tcp
supabase-rest      Up
tempo              Up
```

**If a container is restarting:**
```bash
docker compose logs <service-name> --tail=30
```

Common issues:
- `supabase-db` restart loop → bad `POSTGRES_PASSWORD` or volume permission issue
- `mcp-server` unhealthy → check it can reach supabase-db and redis (network issue)
- `rag-worker` exit → Python import error, check logs
- `supabase-kong` exit → malformed `configs/supabase/kong.yml`

---

## Phase 4: Database Verification

### 4.1 — Confirm PostgreSQL is accepting connections

```bash
docker exec supabase-db pg_isready -U postgres
```

**Expected:** `/var/run/postgresql:5432 - accepting connections`

### 4.2 — Confirm extensions are loaded

```bash
docker exec supabase-db psql -U postgres -c "\dx" | grep -E "vector|pg_trgm"
```

**Expected:** Both `vector` and `pg_trgm` listed.

**If missing:** Migration 001 didn't run. Check:
```bash
docker exec supabase-db ls /docker-entrypoint-initdb.d/
# Should list: 001_extensions.sql  002_documents.sql  003_chunks.sql  004_hybrid_search.sql
```
Note: `docker-entrypoint-initdb.d` only runs on first database initialization. If the volume already existed from a prior run, migrations won't re-execute. Fix:
```bash
docker compose down -v   # ⚠️ destroys all data
docker compose up -d     # fresh init, migrations run
```

### 4.3 — Confirm tables exist

```bash
docker exec supabase-db psql -U postgres -c "\dt"
```

**Expected:** `documents` and `document_chunks` tables listed.

### 4.4 — Confirm hybrid_search function exists

```bash
docker exec supabase-db psql -U postgres -c "\df hybrid_search"
```

**Expected:** One row showing `hybrid_search` function with its parameter types.

### 4.5 — Confirm vector column dimensions

```bash
docker exec supabase-db psql -U postgres -c "
  SELECT column_name, udt_name
  FROM information_schema.columns
  WHERE table_name = 'document_chunks' AND column_name = 'embedding';
"
```

**Expected:** `udt_name` = `vector`

### 4.6 — Confirm triggers are active

```bash
docker exec supabase-db psql -U postgres -c "
  SELECT trigger_name, event_object_table
  FROM information_schema.triggers
  WHERE trigger_schema = 'public';
"
```

**Expected:** Two triggers:
- `trg_documents_updated_at` on `documents`
- `trg_update_search_vector` on `document_chunks`

---

## Phase 5: Redis Verification

### 5.1 — Ping

```bash
docker exec redis redis-cli ping
```

**Expected:** `PONG`

### 5.2 — Confirm BullMQ queues are reachable

```bash
docker exec redis redis-cli KEYS "bull:*"
```

**Expected:** Empty list (no jobs yet) or BullMQ metadata keys. No errors.

---

## Phase 6: MCP Server API

### 6.1 — Health check

```bash
curl -s http://localhost:3100/health | python3 -m json.tool
```

**Expected:**
```json
{
    "status": "ok",
    "embedding_model": "voyage/voyage-3",
    "timestamp": "2026-..."
}
```

### 6.2 — Status (empty knowledgebase)

```bash
curl -s http://localhost:3100/status | python3 -m json.tool
```

**Expected:**
```json
{
    "total_documents": 0,
    "total_chunks": 0,
    "embedding_model": "voyage/voyage-3",
    "embedding_dimensions": 1024,
    "queue_waiting": 0,
    "queue_active": 0
}
```

**If status fails but health works:** Supabase connection issue. Check:
```bash
docker compose logs mcp-server | grep -i "error\|fail\|SUPABASE" | tail -10
```

---

## Phase 7: Supabase Gateway

### 7.1 — Kong is routing to PostgREST

```bash
curl -s http://localhost:8000/rest/v1/ \
  -H "apikey: $(grep ANON_KEY .env | cut -d= -f2)" \
  -H "Authorization: Bearer $(grep ANON_KEY .env | cut -d= -f2)" \
  | python3 -m json.tool | head -5
```

**Expected:** JSON response (list of available tables or empty object). No `401` or `502`.

**If 502:** `supabase-rest` can't reach `supabase-db`. Check:
```bash
docker compose logs supabase-rest | tail -10
```

**If 401:** Key mismatch between `.env` and `configs/supabase/kong.yml`.

---

## Phase 8: Text Ingestion (End-to-End)

### 8.1 — Create a test document

```bash
cat > documents/smoke-test.txt << 'EOF'
The AI Dev Workbench is a portable Docker-based development environment.
It provides hybrid search combining vector similarity and keyword matching.
The system uses SHA256 content hashing to skip unchanged documents.
Embedding models are configurable via the EMBEDDING_MODEL environment variable.
The default model is Voyage voyage-3 with 1024-dimensional vectors.
Documents are chunked with a size of 500 characters and 50-character overlap.
EOF
```

### 8.2 — Ingest via API

```bash
curl -s -X POST http://localhost:3100/ingest \
  -H "Content-Type: application/json" \
  -d '{"filepath": "/workspace/documents/smoke-test.txt"}' \
  | python3 -m json.tool
```

**Expected:**
```json
{
    "status": "ingested",
    "document_id": "<uuid>",
    "chunks": 1,
    "content_hash": "<sha256-hex>"
}
```

Save the document_id and content_hash for later steps:
```bash
INGEST_RESULT=$(curl -s -X POST http://localhost:3100/ingest \
  -H "Content-Type: application/json" \
  -d '{"filepath": "/workspace/documents/smoke-test.txt"}')
DOC_ID=$(echo $INGEST_RESULT | python3 -c "import sys,json; print(json.load(sys.stdin).get('document_id',''))")
HASH=$(echo $INGEST_RESULT | python3 -c "import sys,json; print(json.load(sys.stdin).get('content_hash',''))")
echo "Document ID: $DOC_ID"
echo "Content Hash: $HASH"
```

**If error "File not found":** Volume mount issue. Verify:
```bash
docker exec mcp-server ls /workspace/documents/smoke-test.txt
```
If missing, the `./documents:/workspace/documents` mount in docker-compose isn't working.

**If error about Supabase/embedding:** Check MCP server logs:
```bash
docker compose logs mcp-server --tail=20
```

### 8.3 — Verify in database

```bash
docker exec supabase-db psql -U postgres -c "
  SELECT id, title, source_type, content_hash
  FROM documents
  LIMIT 5;
"
```

**Expected:** One row with title `smoke-test`, source_type `txt`.

```bash
docker exec supabase-db psql -U postgres -c "
  SELECT id, chunk_index, length(content) as content_len,
         embedding IS NOT NULL as has_embedding,
         search_vector IS NOT NULL as has_tsvector
  FROM document_chunks
  LIMIT 5;
"
```

**Expected:** Chunk(s) with `has_embedding = t` and `has_tsvector = t`.

### 8.4 — Verify status updated

```bash
curl -s http://localhost:3100/status | python3 -m json.tool
```

**Expected:** `total_documents: 1`, `total_chunks: 1` (or more depending on doc size).

---

## Phase 9: SHA256 Duplicate Detection

### 9.1 — Re-ingest same file (should skip)

```bash
curl -s -X POST http://localhost:3100/ingest \
  -H "Content-Type: application/json" \
  -d '{"filepath": "/workspace/documents/smoke-test.txt"}' \
  | python3 -m json.tool
```

**Expected:**
```json
{
    "status": "skipped",
    "reason": "unchanged (SHA256 match)",
    "document_id": "<same-uuid>",
    "content_hash": "<same-hash>"
}
```

### 9.2 — Modify file and re-ingest (should process)

```bash
echo "This line was added for the smoke test." >> documents/smoke-test.txt

curl -s -X POST http://localhost:3100/ingest \
  -H "Content-Type: application/json" \
  -d '{"filepath": "/workspace/documents/smoke-test.txt"}' \
  | python3 -m json.tool
```

**Expected:** `"status": "ingested"` with a different `content_hash`.

---

## Phase 10: Hybrid Search / Query

### 10.1 — Query the knowledgebase

```bash
curl -s -X POST http://localhost:3100/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What embedding model does the workbench use by default?"}' \
  | python3 -m json.tool
```

**Expected:**
```json
{
    "answer": "...(mentions Voyage voyage-3 and 1024 dimensions)...",
    "sources": [
        {
            "chunk_id": "...",
            "document_id": "...",
            "similarity": 0.8...,
            "text_rank": 0.0...,
            "hybrid_score": 0.6...
        }
    ],
    "search_method": "hybrid",
    "embedding_model": "voyage/voyage-3",
    "llm_model": "claude-sonnet-4-20250514"
}
```

**Verify:**
- `answer` is relevant and mentions the content from smoke-test.txt
- `sources` array is non-empty
- `similarity` score > 0.5 (semantic match)
- `hybrid_score` > 0 (combined score)

**If answer is "No relevant documents found":**
- Embedding failed during ingest (check mcp-server logs)
- Vector dimensions mismatch (check the embedding column type vs EMBEDDING_DIMENSIONS)
- Hybrid search function has wrong vector size

### 10.2 — Test with a query that shouldn't match

```bash
curl -s -X POST http://localhost:3100/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the recipe for chocolate cake?"}' \
  | python3 -m json.tool
```

**Expected:** Low similarity scores or "No relevant documents found." Confirms search isn't returning everything indiscriminately.

---

## Phase 11: Job Queue

### 11.1 — Check queue depth after ingestion

```bash
curl -s http://localhost:3100/status | python3 -c "
import sys, json
s = json.load(sys.stdin)
print(f'Queue waiting: {s.get(\"queue_waiting\", \"?\")}')
print(f'Queue active:  {s.get(\"queue_active\", \"?\")}')
"
```

**Expected:** Both `0` (text ingestion is inline, no queue needed).

### 11.2 — Verify rag-worker is running and polling

```bash
docker compose logs rag-worker --tail=5
```

**Expected:** Lines showing the worker is started and listening:
```
🔄 RAG Worker started — listening for jobs...
   Embedding model: voyage/voyage-3
   Redis: redis://redis:6379
```

### 11.3 — Test multimodal queue routing (dry run)

Create a dummy PDF to test queue routing (not actual PDF processing — that requires a real PDF):

```bash
echo "This is not a real PDF" > documents/fake.pdf

curl -s -X POST http://localhost:3100/ingest \
  -H "Content-Type: application/json" \
  -d '{"filepath": "/workspace/documents/fake.pdf"}' \
  | python3 -m json.tool
```

**Expected:**
```json
{
    "status": "queued",
    "reason": "Multimodal file queued for rag-worker",
    "job_id": "..."
}
```

This confirms the `.pdf` extension triggers the queue path instead of inline processing.

Check the worker received it:
```bash
docker compose logs rag-worker --tail=10
```

**Expected:** The worker should log the job attempt (it will fail on the fake file, which is fine — we're testing the routing).

Clean up:
```bash
rm documents/fake.pdf
```

---

## Phase 12: MCP Bridge

### 12.1 — Verify bridge is installed in claude-code container

```bash
docker exec claude-code ls /opt/mcp-bridge/
```

**Expected:** `index.js`, `node_modules/`, `package.json`

### 12.2 — Verify bridge can reach MCP server

```bash
docker exec claude-code wget -q -O - http://mcp-server:3100/health
```

**Expected:** JSON health response. Confirms DNS resolution on the Docker network works.

### 12.3 — Test bridge module loading

```bash
docker exec claude-code timeout 3 node -e "
  import('/opt/mcp-bridge/index.js')
    .then(() => console.log('Bridge loaded OK'))
    .catch(e => console.log('Load error:', e.message));
  setTimeout(() => process.exit(0), 2000);
" 2>&1 || echo "(timeout expected — bridge waits for stdio)"
```

**Expected:** `Bridge loaded OK` (or timeout, which is fine — the bridge blocks waiting for stdio input).

---

## Phase 13: MCP Registration

### 13.1 — Register the bridge with Claude Code

```bash
docker exec claude-code claude mcp add workbench \
  -s user \
  -- node /opt/mcp-bridge/index.js
```

**Expected:** Success message confirming registration.

### 13.2 — Verify registration

```bash
docker exec claude-code claude mcp list
```

**Expected:** `workbench` listed as a registered MCP server.

### 13.3 — Test MCP tool listing (optional, if Claude Code is authenticated)

If you've already authenticated Claude Code:

```bash
docker exec -it claude-code claude -p "Use the rag_status tool and tell me the results"
```

**Expected:** Claude Code calls the `rag_status` MCP tool and reports document/chunk counts.

---

## Phase 14: Observability

### 14.1 — OTel Collector is receiving

```bash
curl -s http://localhost:4318/v1/traces -X POST \
  -H "Content-Type: application/json" \
  -d '{}' 2>&1 | head -5
```

**Expected:** A response (even an error response like `400` is fine — it means the collector is listening). A connection refused means the collector didn't start.

### 14.2 — Grafana is accessible

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3200/api/health
```

**Expected:** `200`

### 14.3 — Tempo datasource is provisioned in Grafana

```bash
curl -s http://localhost:3200/api/datasources \
  -u admin:admin \
  | python3 -c "
import sys, json
ds = json.load(sys.stdin)
for d in ds:
    print(f'  {d[\"name\"]} ({d[\"type\"]}) → {d[\"url\"]}')
"
```

**Expected:** `Tempo (tempo) → http://tempo:3200`

### 14.4 — Open Grafana in browser (manual)

Navigate to [http://localhost:3200](http://localhost:3200), login `admin`/`admin`.
Go to **Explore** → select **Tempo** datasource → **Search** tab.

If you ran queries/ingestions earlier, you may see traces. If not, that's expected — OTel instrumentation in the application code is a future enhancement; the infrastructure is verified working.

---

## Phase 15: Optional Profiles

### 15.1 — Supabase Studio

```bash
docker compose --profile studio up -d

# Wait for it to start
sleep 10

curl -s -o /dev/null -w "%{http_code}" http://localhost:3001
```

**Expected:** `200`. Open [http://localhost:3001](http://localhost:3001) in a browser to see the database UI.

Verify it can see the tables:
```bash
curl -s http://localhost:3001 | grep -o "Supabase" | head -1
```

**Expected:** `Supabase`

### 15.2 — Neo4j

```bash
docker compose --profile neo4j up -d

# Wait for startup
sleep 15

curl -s -o /dev/null -w "%{http_code}" http://localhost:7474
```

**Expected:** `200`. Open [http://localhost:7474](http://localhost:7474) in a browser.

Login: `neo4j` / value of `POSTGRES_PASSWORD` from your `.env`.

```bash
docker exec neo4j cypher-shell -u neo4j -p "$POSTGRES_PASSWORD" "RETURN 1 AS test;"
```

**Expected:** Returns `1`.

---

## Phase 16: Backup and Restore Cycle

### 16.1 — Create a backup

```bash
make backup
```

**Expected:**
```
▸ Backing up database...
✓ Backup complete: backups/workbench-YYYYMMDD-HHMMSS.sql.gz (Xk)
  Symlink: backups/latest.sql.gz → workbench-YYYYMMDD-HHMMSS.sql.gz
```

### 16.2 — Verify the backup file

```bash
ls -lh backups/latest.sql.gz
gunzip -c backups/latest.sql.gz | head -20
```

**Expected:** First lines should show PostgreSQL dump header and `SET` statements.

### 16.3 — Destroy and restore

```bash
# Record current state
PRE_DOCS=$(docker exec supabase-db psql -U postgres -t -c "SELECT count(*) FROM documents;" | xargs)
echo "Documents before destroy: $PRE_DOCS"

# Destroy database volume
docker compose down -v
docker compose up -d

# Wait for fresh DB to initialize
echo "Waiting for fresh database..."
sleep 30

# Verify it's empty
EMPTY_DOCS=$(docker exec supabase-db psql -U postgres -t -c "SELECT count(*) FROM documents;" | xargs)
echo "Documents after fresh init: $EMPTY_DOCS"
# Expected: 0

# Restore
make restore
# Enter 'y' when prompted

# Verify restoration
POST_DOCS=$(docker exec supabase-db psql -U postgres -t -c "SELECT count(*) FROM documents;" | xargs)
echo "Documents after restore: $POST_DOCS"
# Expected: matches PRE_DOCS
```

### 16.4 — Verify restored data is queryable

```bash
curl -s -X POST http://localhost:3100/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What embedding model is used?"}' \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print(f'Answer length: {len(r.get(\"answer\", \"\"))} chars')
print(f'Sources: {len(r.get(\"sources\", []))}')
print(f'Top score: {r[\"sources\"][0][\"hybrid_score\"] if r.get(\"sources\") else \"no sources\"}')
"
```

**Expected:** Non-empty answer with sources. Embeddings survived the backup/restore cycle.

---

## Phase 17: Claude Code Interactive Session

### 17.1 — Enter Claude Code

```bash
docker exec -it claude-code claude
```

First time: Claude Code will show an authentication URL. Open it in your browser, authenticate, and paste the token back.

### 17.2 — Test slash commands

Once inside the interactive session:

```
> /status
```
**Expected:** Claude uses the `rag_status` MCP tool and reports document/chunk counts.

```
> /query What is the default chunk size?
```
**Expected:** Claude uses `rag_query` and answers based on the smoke-test document (500 characters).

```
> /ingest documents/smoke-test.txt
```
**Expected:** Claude uses `rag_ingest` and reports either `ingested` (if re-modified) or `skipped` (if unchanged).

### 17.3 — Test natural language tool use

```
> How many documents are in the knowledgebase right now?
```
**Expected:** Claude autonomously calls `rag_status` and reports the count.

```
> Search the knowledgebase for information about SHA256 hashing
```
**Expected:** Claude calls `rag_query` with an appropriate question and returns results.

Exit Claude Code: `Ctrl+C` or type `/exit`.

---

## Phase 18: Cleanup

### 18.1 — Remove test data (keep stack running)

```bash
docker exec supabase-db psql -U postgres -c "
  DELETE FROM document_chunks;
  DELETE FROM documents;
"
rm -f documents/smoke-test.txt
```

### 18.2 — Full teardown (stop everything, preserve volumes)

```bash
docker compose --profile studio --profile neo4j down
```

### 18.3 — Nuclear teardown (destroy everything including data)

```bash
docker compose --profile studio --profile neo4j down -v
rm -f backups/*.sql.gz
```

---

## Smoke Test Checklist

Copy this checklist and check off each item as you go:

```
PRE-FLIGHT
[ ] Docker running, compose v2 available
[ ] Ports free (3100, 5432, 6379, 8000, 3200, 4318)
[ ] .env created with real API keys

BUILD & START
[ ] docker compose build — all 3 images built
[ ] docker compose up -d — 10 containers running
[ ] Health checks pass (supabase-db, redis, mcp-server)

DATABASE
[ ] pg_isready — accepting connections
[ ] Extensions: vector, pg_trgm loaded
[ ] Tables: documents, document_chunks exist
[ ] Function: hybrid_search exists
[ ] Triggers: updated_at, search_vector active

REDIS
[ ] redis-cli ping — PONG

API
[ ] GET /health — status ok
[ ] GET /status — 0 documents, 0 chunks

SUPABASE GATEWAY
[ ] Kong routing to PostgREST — 200 response

INGESTION
[ ] Text ingest — status: ingested, chunks > 0
[ ] Database has document + chunks with embeddings + tsvector
[ ] Status updated — total_documents: 1

DEDUP
[ ] Re-ingest same file — status: skipped (SHA256 match)
[ ] Modify + re-ingest — status: ingested (new hash)

SEARCH
[ ] Relevant query — answer with sources, similarity > 0.5
[ ] Irrelevant query — low scores or no results

QUEUE
[ ] Worker running and polling
[ ] PDF triggers queue path — status: queued

MCP BRIDGE
[ ] Bridge installed in claude-code container
[ ] Network connectivity to mcp-server
[ ] Bridge module loads

MCP REGISTRATION
[ ] claude mcp add workbench — success
[ ] claude mcp list — workbench listed

OBSERVABILITY
[ ] OTel Collector listening on :4318
[ ] Grafana accessible on :3200
[ ] Tempo datasource provisioned

OPTIONAL PROFILES
[ ] Supabase Studio on :3001 (--profile studio)
[ ] Neo4j on :7474 (--profile neo4j)

BACKUP/RESTORE
[ ] make backup — creates .sql.gz in backups/
[ ] Destroy + restore — data survives round-trip
[ ] Restored data is queryable

CLAUDE CODE SESSION
[ ] Interactive session starts
[ ] /status works
[ ] /query returns relevant results
[ ] /ingest processes a document
```
