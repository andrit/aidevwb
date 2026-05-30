---
name: production-rag-operations
description: Operate a RAG pipeline in production — embedding provider selection, API auth, retrieval latency monitoring, corpus backup and re-ingestion cadence, degraded-mode fallback when the embedding service is unavailable
domain: rag
type: rag
triggers:
  - "rag production"
  - "deploy rag"
  - "embedding provider"
  - "rag monitoring"
  - "corpus backup"
  - "rag degraded mode"
  - "retrieval latency"
  - "rag auth"
  - "re-ingestion"
---

# Production RAG Operations

## When to use

When a RAG application built in the workbench is ready to serve real users. Development RAG runs with a shared embedding service, no auth on the query endpoint, and no backup strategy. Production RAG needs: an explicit embedding provider choice with lock-in awareness, API auth on `/query`, retrieval latency monitoring, regular corpus backups, and a fallback that keeps the app usable when the embedding service is temporarily down.

## Prerequisites

- RAG stack working in workbench (`ingest-and-validate` + `tune-search-quality` complete)
- `make export-stack NAME=<project> FORMAT=compose` run
- Embedding model chosen and API key provisioned
- `production-config-and-secrets` complete (auth config from env)

## Embedding Provider Selection

The choice locks in your vector dimensions and normalizes your query costs. Think carefully before switching providers — a switch requires re-ingesting the entire corpus.

| Provider | Model | Dimensions | Cost | Notes |
|----------|-------|-----------|------|-------|
| Voyage AI | voyage-3 | 1024 | $0.06/1M tokens | Workbench default; best recall for technical docs |
| OpenAI | text-embedding-3-small | 1536 | $0.02/1M tokens | Lowest cost; good general-purpose |
| OpenAI | text-embedding-3-large | 3072 | $0.13/1M tokens | Highest accuracy; 3× the storage |
| Cohere | embed-v3.0 | 1024 | $0.10/1M tokens | Good multilingual support |
| Local (Ollama) | nomic-embed-text | 768 | Free | No external dependency; lower recall |

**Lock-in mitigations:**
- Store `embedding_model` and `embedding_dimensions` in each document's metadata row.
- Never hardcode dimensions in SQL — read from `EMBEDDING_DIMENSIONS` env var.
- When switching providers, create a new corpus (new project or versioned table prefix) rather than overwriting. Run both in parallel during transition.

## Step 1 — Secure the Query Endpoint

The `/query` endpoint returns content from your knowledge base. Leaving it unauthenticated exposes your corpus to competitors and runs up embedding API costs.

```typescript
// src/routes/rag.ts — add auth to query route
import { FastifyPluginAsync } from "fastify";
import { verifyApiKey } from "../middleware/auth.js";

const ragRoutes: FastifyPluginAsync = async (app) => {
  // Public ingest endpoint (server-to-server, protected by network policy)
  app.post("/ingest", { preHandler: [verifyApiKey] }, ingestHandler);

  // Authenticated query endpoint
  app.post("/query", { preHandler: [verifyApiKey] }, queryHandler);

  // Status endpoint — intentionally public for uptime monitoring
  app.get("/status", statusHandler);
};
```

```typescript
// src/middleware/auth.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";

export async function verifyApiKey(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const key = req.headers["x-api-key"] ?? req.headers["authorization"]?.replace("Bearer ", "");
  if (!key || key !== config.ragApiKey) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}
```

```typescript
// src/config.ts — add to ConfigSchema
ragApiKey: z.string().min(32, "RAG_API_KEY must be at least 32 characters"),
```

## Step 2 — Retrieval Latency Monitoring

Slow queries erode user trust faster than wrong answers. Track latency at the component level so you know whether slowness is in embedding, vector search, or LLM synthesis.

```typescript
// src/services/rag.ts — instrument the query path
import { withSpan, spanAttrs } from "../lib/tracing.js";
import { logger } from "../lib/logging.js";

export async function queryWithMetrics(
  db: Db,
  query: string,
  opts: QueryOptions
): Promise<QueryResult> {
  const startMs = Date.now();

  return withSpan("rag.query", async (span) => {
    // Phase 1: embed the query
    const embedStart = Date.now();
    const embedding = await embedText(query);
    const embedMs = Date.now() - embedStart;
    span.setAttribute("rag.embed_ms", embedMs);

    // Phase 2: vector search
    const searchStart = Date.now();
    const chunks = await hybridSearch(db, embedding, query, opts);
    const searchMs = Date.now() - searchStart;
    span.setAttribute("rag.search_ms", searchMs);
    span.setAttribute("rag.chunks_returned", chunks.length);

    // Phase 3: synthesis (if enabled)
    const synthesisMs = opts.synthesize ? await measureSynthesis(chunks, query, span) : 0;

    const totalMs = Date.now() - startMs;
    span.setAttribute("rag.total_ms", totalMs);

    logger.info("RAG query complete", {
      embedMs,
      searchMs,
      synthesisMs,
      totalMs,
      chunksReturned: chunks.length,
      queryLength: query.length,
    });

    // Alert on slow queries
    if (totalMs > config.ragSlowQueryThresholdMs) {
      logger.warn("RAG slow query", { totalMs, query: query.slice(0, 100) });
    }

    return { chunks, totalMs, embedMs, searchMs };
  });
}
```

```typescript
// src/config.ts — add monitoring thresholds
ragSlowQueryThresholdMs: z.coerce.number().default(2000),
ragAlertOnEmptyResults: z.coerce.boolean().default(true),
```

Add a monitoring query for your aggregator:

```sql
-- Retrieval latency percentiles (run in Grafana or your query tool)
SELECT
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as queries,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms) as p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) as p99_ms,
  COUNT(*) FILTER (WHERE chunks_returned = 0) as empty_results
FROM rag_query_log
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1
ORDER BY 1 DESC;
```

## Step 3 — Corpus Backup Strategy

The vector index is derived from the source documents — it can be rebuilt. The source documents themselves are the irreplaceable asset.

```bash
# scripts/backup-corpus.sh
#!/usr/bin/env bash
set -e

PROJECT="${1:?Usage: backup-corpus.sh <project-name>}"
BACKUP_DIR="${BACKUP_DIR:-/backups/rag}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${PROJECT}-corpus-${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Backing up corpus for project: $PROJECT"

# Dump documents + chunks (includes embeddings — large but allows full restore without re-ingestion)
pg_dump \
  --host="$POSTGRES_HOST" \
  --username="$POSTGRES_USER" \
  --dbname="$PROJECT" \
  --table=documents \
  --table=document_chunks \
  --no-password \
  | gzip > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "Backup complete: $BACKUP_FILE ($SIZE)"

# Prune backups older than 30 days
find "$BACKUP_DIR" -name "${PROJECT}-corpus-*.sql.gz" -mtime +30 -delete
echo "Pruned backups older than 30 days"
```

Add to crontab or a Docker cron service:
```
0 2 * * * /scripts/backup-corpus.sh myproject  # nightly at 2am
```

## Step 4 — Re-ingestion Cadence

Static corpora (documentation, whitepapers) need infrequent re-ingestion. Dynamic corpora (product catalog, support tickets) need a schedule.

```typescript
// src/jobs/reingestion.ts
import { logger } from "../lib/logging.js";

export async function runScheduledReingestion(db: Db): Promise<void> {
  const cutoff = new Date(Date.now() - config.reingestionIntervalMs);

  // Find documents that haven't been re-checked since the cutoff
  const stale = await db.any(
    "SELECT id, source_url, content_hash FROM documents WHERE last_ingested_at < $1",
    [cutoff]
  );

  logger.info("Scheduled re-ingestion", { staleCount: stale.length });

  for (const doc of stale) {
    try {
      const freshContent = await fetchFromSource(doc.source_url);
      const freshHash = hash(freshContent);

      if (freshHash === doc.content_hash) {
        // Content unchanged — just update the timestamp
        await db.none(
          "UPDATE documents SET last_ingested_at = NOW() WHERE id = $1",
          [doc.id]
        );
        continue;
      }

      // Content changed — re-chunk and re-embed
      await reingestDocument(db, doc.id, freshContent);
      logger.info("Document re-ingested", { docId: doc.id, source: doc.source_url });
    } catch (err) {
      logger.error("Re-ingestion failed for document", { docId: doc.id, err });
    }
  }
}
```

```typescript
// src/config.ts
reingestionIntervalMs: z.coerce.number().default(7 * 24 * 3600 * 1000), // weekly
```

## Step 5 — Degraded-Mode Fallback

When the embedding service is down, vector search is unavailable. Keyword search still works. Implement a fallback so the app degrades gracefully rather than returning 500s.

```typescript
// src/services/rag.ts
export async function queryWithFallback(
  db: Db,
  query: string,
  opts: QueryOptions
): Promise<QueryResult & { degraded: boolean }> {
  // Try full hybrid (vector + keyword) search first
  try {
    const embedding = await embedText(query);  // may throw if provider is down
    const chunks = await hybridSearch(db, embedding, query, opts);
    return { chunks, degraded: false, totalMs: 0 };

  } catch (embedErr) {
    logger.warn("Embedding service unavailable — falling back to keyword search", {
      error: String(embedErr),
    });

    // Keyword-only fallback: full-text search via tsvector
    const chunks = await keywordSearch(db, query, opts);
    return { chunks, degraded: true, totalMs: 0 };
  }
}

async function keywordSearch(db: Db, query: string, opts: QueryOptions): Promise<Chunk[]> {
  return db.any(
    `SELECT id, content, metadata,
            ts_rank(search_vector, plainto_tsquery('english', $1)) AS score
     FROM document_chunks
     WHERE project_id = $2
       AND search_vector @@ plainto_tsquery('english', $1)
     ORDER BY score DESC
     LIMIT $3`,
    [query, opts.projectId, opts.limit ?? 10]
  );
}
```

Surface the degraded flag to the caller:

```typescript
// src/routes/rag.ts
const result = await queryWithFallback(db, body.query, opts);
return reply.send({
  chunks: result.chunks,
  degraded: result.degraded,
  degradedReason: result.degraded ? "embedding_service_unavailable" : undefined,
});
```

## Checklist

- [ ] `RAG_API_KEY` set (32+ chars) — `/query` and `/ingest` return 401 without it
- [ ] `embedding_model` stored in document metadata — provider switch doesn't corrupt existing records
- [ ] `EMBEDDING_DIMENSIONS` is env var, not hardcoded in SQL
- [ ] Retrieval latency logged per query: `embedMs`, `searchMs`, `totalMs`
- [ ] Slow query threshold set in `RAG_SLOW_QUERY_THRESHOLD_MS` env var
- [ ] `rag_query_log` table records queries for latency trend analysis
- [ ] Corpus backup script running on schedule (nightly recommended)
- [ ] Backups pruned after 30 days to control storage
- [ ] Re-ingestion job scheduled; change detection via content hash avoids unnecessary re-embedding
- [ ] Keyword fallback returns results (not 500) when embedding service is down
- [ ] Response includes `degraded: true` flag when in fallback mode — callers can warn users

## Files involved

| File | Action |
|------|--------|
| `src/middleware/auth.ts` | Create: `verifyApiKey` — checks `x-api-key` or `Authorization: Bearer` |
| `src/routes/rag.ts` | Update: add `preHandler: [verifyApiKey]` to `/query` and `/ingest` |
| `src/services/rag.ts` | Update: `queryWithFallback`, `queryWithMetrics`, `keywordSearch` |
| `src/jobs/reingestion.ts` | Create: `runScheduledReingestion` |
| `src/config.ts` | Update: `ragApiKey`, `ragSlowQueryThresholdMs`, `reingestionIntervalMs` |
| `scripts/backup-corpus.sh` | Create: nightly corpus backup |

## Common mistakes

**Re-ingesting to detect changes by polling the source on every query** — check the source on a schedule, not at query time. Query-time source fetches add latency and make the system fragile: if the source is slow, every user query is slow.

**No content hash — re-ingesting unchanged documents** — re-embedding a document that hasn't changed costs money and bloats the chunks table with duplicate vectors. Hash the content before and after; skip if equal.

**Treating vector search failure as a 500** — the embedding service has SLAs below 100%. A transient provider outage should degrade to keyword search, not take down your application. Return `degraded: true` in the response so the UI can show a subtle warning.

**Backing up only the chunks table (not documents)** — the documents table has the original text, source URL, and metadata. The chunks table has the derived vectors. Back up both; if you lose the documents table you cannot audit what content is in the corpus.
