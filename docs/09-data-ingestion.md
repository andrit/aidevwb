# Data Ingestion — Types, Processing, Storage & Access

## How Ingestion Works (Overview)

Every document enters the system through the same endpoint (`POST /ingest` or the `rag_ingest` MCP tool). What happens next depends on the file type:

```
File arrives at /ingest
    ↓
Read file bytes → compute SHA256 hash
    ↓
Hash exists in database?
    ├── YES → Return "skipped" (no cost, no processing)
    └── NO  → Check file extension
                ├── Text-based (.txt, .md, .json, .csv, .yaml, .xml)
                │   → Inline processing (fast, same request)
                │   → Read → Chunk → Embed → Store → Return "ingested"
                │
                └── Multimodal (.pdf, .png, .jpg, .gif, .webp, .tiff)
                    → Queue to Python worker (async)
                    → Return "queued" immediately
                    → Worker: RAG-Anything parse → Chunk → Embed → Store
```

## Text-Based Files

### Supported Extensions
`.txt`, `.md`, `.json`, `.csv`, `.yaml`, `.yml`, `.xml`, `.html`, `.log`, `.conf`, `.ini`, `.toml`, `.env`, `.sh`, `.py`, `.ts`, `.js`, `.sql`, `.go`, `.rs`, `.java`, `.rb`, `.php`, `.swift`, `.kt`

Any file not in the multimodal set is treated as text.

### Processing Pipeline

**Step 1: Read**

The MCP server reads the file as UTF-8 text:

```typescript
// apps/mcp-server/src/services/ingest.ts
const fileBuffer = await readFile(filepath);
const text = fileBuffer.toString("utf-8");
```

Files with non-UTF-8 encoding (e.g., Latin-1, Windows-1252) will have corrupted characters. For binary files misclassified as text, the content will be garbled but won't crash the system.

**Step 2: Hash**

SHA256 of the raw file bytes (not the decoded text):

```typescript
const contentHash = createHash("sha256").update(fileBuffer).digest("hex");
```

This produces a 64-character hex string like `a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a`.

**Step 3: Chunk**

Split into 500-character pieces with 50-character overlap:

```
Original text (1200 chars):
[==========|==========|==========]

Chunk 1: chars 0-500
Chunk 2: chars 450-950    ← 50 chars overlap with chunk 1
Chunk 3: chars 900-1200   ← 50 chars overlap with chunk 2
```

Configuration in `apps/mcp-server/src/config.ts`:
```typescript
chunkSize: 500,     // Characters per chunk
chunkOverlap: 50,   // Overlap between chunks
```

**Step 4: Embed**

Each chunk is sent to OpenRouter's embedding API in batches of 100:

```typescript
// apps/mcp-server/src/services/embeddings.ts
const response = await client.embeddings.create({
  model: "voyage/voyage-3",   // From EMBEDDING_MODEL env var
  input: batchOfChunks,       // Up to 100 strings
});
// Returns: array of 1024-dimensional float vectors
```

**Step 5: Store**

Document record + chunk records are inserted into Supabase:

```typescript
// Document record
const { data: doc } = await supabase.from("documents").insert({
  title: "filename-without-extension",
  source_type: "md",
  source_path: "/workspace/documents/file.md",
  content_hash: "a7ffc6f8...",
  metadata: { filename: "file.md", size_bytes: 1200, chunk_count: 3 }
}).select("id").single();

// Chunk records (batch)
const rows = chunks.map((content, i) => ({
  document_id: doc.id,
  content: content,                    // The text
  embedding: embeddings[i],            // vector(1024)
  chunk_index: i,                      // Order within document
  metadata: { chunk_size: content.length }
}));
await supabase.from("document_chunks").insert(rows);
```

The `search_vector` (tsvector) column is auto-populated by a PostgreSQL trigger:

```sql
-- supabase/migrations/003_chunks.sql
CREATE TRIGGER trg_update_search_vector
  BEFORE INSERT OR UPDATE ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION update_search_vector();

-- The trigger function:
NEW.search_vector := to_tsvector('english', coalesce(NEW.content, ''));
```

### How Text Data Is Stored

```
PostgreSQL (supabase-db:5432)
  └── database: postgres
      └── schema: public
          ├── documents
          │   └── Row: { id, title, source_type, source_path, content_hash, metadata }
          │
          └── document_chunks
              └── Row: {
                    id,
                    document_id (FK → documents.id),
                    content (text),
                    embedding (vector(1024) — float array),
                    search_vector (tsvector — keyword index),
                    chunk_index (integer — order),
                    metadata (jsonb)
                  }
```

### How to Access Stored Text Data

**Via the API (recommended):**
```bash
# Search for relevant chunks
curl -s -X POST http://localhost:3100/query \
  -H "Content-Type: application/json" \
  -d '{"question": "your question", "top_k": 5}'
```

**Via SQL (direct database access):**
```bash
# Open a psql shell
make db-shell

# List all documents
SELECT id, title, source_type, content_hash, metadata->>'chunk_count' as chunks
FROM documents ORDER BY created_at DESC;

# View chunks for a specific document
SELECT chunk_index, left(content, 100) as preview, embedding IS NOT NULL as embedded
FROM document_chunks
WHERE document_id = 'your-uuid'
ORDER BY chunk_index;

# Manual vector similarity search
SELECT content, 1 - (embedding <=> '[0.1, 0.2, ...]'::vector) as similarity
FROM document_chunks
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 5;

# Manual keyword search
SELECT content, ts_rank(search_vector, plainto_tsquery('your search terms')) as rank
FROM document_chunks
WHERE search_vector @@ plainto_tsquery('your search terms')
ORDER BY rank DESC
LIMIT 5;
```

**Via Supabase Studio (visual UI):**
```bash
make studio
# Open http://localhost:3001
# Navigate to Table Editor → documents / document_chunks
```

## Multimodal Files (PDFs, Images)

### Supported Extensions
`.pdf`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.tiff`

### Processing Pipeline

Multimodal files are too complex (and slow) for inline processing. They're queued to the Python worker:

**Step 1: Queue**

The MCP server enqueues a BullMQ job:

```typescript
// apps/mcp-server/src/services/queue.ts
const job = await queue.add("ingest-document", { filepath }, {
  attempts: 3,                              // Retry up to 3 times
  backoff: { type: "exponential", delay: 2000 },  // 2s, 4s, 8s
});
return job.id;
```

The API responds immediately: `{ "status": "queued", "job_id": "123" }`.

**Step 2: Worker Picks Up Job**

The Python worker polls Redis:

```python
# apps/rag-worker/lib/worker.py
job_data = redis_client.brpoplpush("bull:ingest:wait", "bull:ingest:active", timeout=5)
```

**Step 3: RAG-Anything Processing**

RAG-Anything handles the multimodal parsing:

```python
# apps/rag-worker/lib/worker.py
from raganything import RAGAnything, RAGAnythingConfig

rag = RAGAnything(config=config, llm_model_func=llm_func, embedding_func=embed_func)
await rag.process_document_complete(str(filepath), output_dir)
```

What RAG-Anything does for PDFs:
1. Extracts text from each page
2. Identifies and extracts tables (converts to text/markdown)
3. Identifies and describes images and charts (using the LLM for visual understanding)
4. Identifies mathematical equations
5. Produces structured text output that captures the full document semantics

**Step 4: Embed and Store**

After parsing, the worker embeds the extracted text and stores it in Supabase (same pattern as text ingestion):

```python
doc = supabase.table("documents").insert({
    "title": path.stem,
    "source_type": "pdf",
    "source_path": str(path.absolute()),
    "content_hash": file_hash,
    "metadata": {
        "processor": "rag-anything",
        "multimodal": True,
    }
}).execute()
```

### Where Multimodal Processing Artifacts Are Stored

```
Container: rag-worker
  └── /app/rag_storage/          ← Docker volume: rag-storage
      └── parsed/
          └── document-name/     ← RAG-Anything working directory
              ├── text/          ← Extracted text per page
              ├── tables/        ← Extracted tables
              ├── images/        ← Extracted images
              └── metadata.json  ← Processing metadata
```

These are intermediate working files. The final searchable data is in Supabase (same as text files).

### PDF Fallback

If RAG-Anything isn't available (import error), the worker falls back to treating the PDF as text:

```python
except ImportError:
    print("RAG-Anything not available, falling back to text extraction")
    return _ingest_text(path, file_hash)
```

This produces lower-quality results (no table/image understanding) but doesn't block ingestion.

## Structured Data (JSON, CSV, YAML)

### JSON Files

JSON is treated as text — the entire file is chunked as-is. This works well for:
- API response examples
- Configuration files
- Schema definitions

For large JSON files (>100KB), consider preprocessing:

```bash
# Split a large JSON array into individual files
python3 -c "
import json
with open('documents/large.json') as f:
    data = json.load(f)
for i, item in enumerate(data):
    with open(f'documents/items/item-{i}.json', 'w') as f:
        json.dump(item, f, indent=2)
"
```

### CSV Files

CSV is also treated as text. The chunking preserves rows, but a 500-character chunk might cut a row mid-field. For better results with CSVs:

**Option 1: Convert to Markdown tables**
```bash
python3 -c "
import csv
with open('documents/data.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        md = ' | '.join(f'{k}: {v}' for k, v in row.items())
        print(md)
" > documents/data.md
```

**Option 2: Convert to row-per-file**
```bash
python3 -c "
import csv, json
with open('documents/data.csv') as f:
    reader = csv.DictReader(f)
    for i, row in enumerate(reader):
        with open(f'documents/rows/row-{i}.json', 'w') as out:
            json.dump(row, out, indent=2)
"
```

### YAML Files

YAML works well as-is because it's human-readable text. Configuration files, Kubernetes manifests, and OpenAPI specs ingest naturally.

## How the System Uses Stored Data

### During a Query

1. Your question is embedded using the same model that embedded the chunks:
   ```
   "What is the refund policy?" → vector(1024)
   ```

2. PostgreSQL runs the `hybrid_search()` function:
   ```sql
   -- Semantic: cosine distance between query vector and all chunk vectors
   1 - (chunk.embedding <=> query_embedding)

   -- Keyword: PostgreSQL full-text search rank
   ts_rank(chunk.search_vector, plainto_tsquery('refund policy'))

   -- Combined: 70% semantic + 30% keyword
   0.7 * semantic + 0.3 * keyword → hybrid_score
   ```

3. Top-K chunks (default 5) are returned, sorted by `hybrid_score`.

4. Chunk contents are concatenated into a context string:

   ```
   Context:
   [Chunk 1 text]
   ---
   [Chunk 2 text]
   ---
   [Chunk 3 text]
   ```

5. Claude receives the context + question and generates an answer.

### During a Re-Ingest

When you re-ingest a file after modifying it:

1. New SHA256 hash is computed
2. Hash differs from stored hash → system processes the new version
3. A new document record is created (the old one remains)
4. New chunks with new embeddings are stored

Note: the current implementation creates a new document record rather than updating the existing one. If you want to clean up old versions:

```sql
-- Find duplicate titles (different hashes)
SELECT title, count(*), array_agg(id) as versions
FROM documents
GROUP BY title
HAVING count(*) > 1;

-- Delete old versions (keeps the latest)
DELETE FROM documents
WHERE id IN (
  SELECT id FROM documents d1
  WHERE EXISTS (
    SELECT 1 FROM documents d2
    WHERE d2.title = d1.title
    AND d2.created_at > d1.created_at
  )
);
-- CASCADE DELETE removes associated chunks automatically
```

## Ingestion Performance

| File Type | Size | Chunks | Embed Time | Total Time | Cost (approx) |
|-----------|------|--------|------------|------------|---------------|
| .txt 1KB  | 1KB  | 2-3    | ~0.5s      | ~1s        | <$0.001       |
| .md 10KB  | 10KB | ~20    | ~2s        | ~3s        | ~$0.001       |
| .json 50KB| 50KB | ~100   | ~10s       | ~12s       | ~$0.005       |
| .pdf 20pg | 2MB  | ~40    | ~5s        | ~30s*      | ~$0.01        |
| .pdf 100pg| 10MB | ~200   | ~20s       | ~120s*     | ~$0.05        |

*PDF times include RAG-Anything parsing (OCR, table extraction, image analysis).

## Walkthrough: Ingesting Different Data Types

### Text File

```bash
# Create and ingest
echo "The refund policy allows returns within 30 days." > documents/policy.txt

curl -s -X POST http://localhost:3100/ingest \
  -H "Content-Type: application/json" \
  -d '{"filepath": "/workspace/documents/policy.txt"}' | python3 -m json.tool
```

**Expected:** `{ "status": "ingested", "chunks": 1, ... }`

### Markdown Documentation

```bash
# Create a structured doc
cat > documents/api-guide.md << 'EOF'
# Authentication

All API requests require a Bearer token in the Authorization header.

## Getting a Token

POST /auth/token with your client_id and client_secret.
The response includes an access_token valid for 1 hour.

## Refreshing a Token

POST /auth/refresh with your refresh_token.

# Rate Limits

- Free tier: 100 requests/minute
- Pro tier: 1000 requests/minute
- Enterprise: unlimited
EOF

curl -s -X POST http://localhost:3100/ingest \
  -H "Content-Type: application/json" \
  -d '{"filepath": "/workspace/documents/api-guide.md"}' | python3 -m json.tool
```

**Expected:** `{ "status": "ingested", "chunks": 2-3, ... }`

### JSON Configuration

```bash
cat > documents/config-reference.json << 'EOF'
{
  "database": {
    "host": "localhost",
    "port": 5432,
    "max_connections": 20,
    "ssl": true,
    "description": "PostgreSQL connection settings"
  },
  "cache": {
    "host": "localhost",
    "port": 6379,
    "ttl_seconds": 3600,
    "description": "Redis cache settings"
  }
}
EOF

curl -s -X POST http://localhost:3100/ingest \
  -H "Content-Type: application/json" \
  -d '{"filepath": "/workspace/documents/config-reference.json"}' | python3 -m json.tool
```

### PDF Document

```bash
# Copy a PDF into the documents directory
cp ~/path/to/report.pdf documents/

# Ingest — this will be queued for async processing
curl -s -X POST http://localhost:3100/ingest \
  -H "Content-Type: application/json" \
  -d '{"filepath": "/workspace/documents/report.pdf"}' | python3 -m json.tool
```

**Expected:** `{ "status": "queued", "job_id": "...", ... }`

Monitor progress:
```bash
# Watch the worker logs
docker compose logs -f rag-worker

# Check queue depth
curl -s http://localhost:3100/status | python3 -c "
import sys, json
s = json.load(sys.stdin)
print(f'Documents: {s[\"total_documents\"]}')
print(f'Chunks: {s[\"total_chunks\"]}')
print(f'Queue waiting: {s.get(\"queue_waiting\", 0)}')
print(f'Queue active: {s.get(\"queue_active\", 0)}')
"
```

### Verify Everything Is Queryable

After ingesting all the above:

```bash
# Query across all document types
curl -s -X POST http://localhost:3100/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the rate limits?"}' | python3 -m json.tool

curl -s -X POST http://localhost:3100/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What port does the database use?"}' | python3 -m json.tool

curl -s -X POST http://localhost:3100/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the refund policy?"}' | python3 -m json.tool
```

Each query searches across ALL ingested documents simultaneously — the markdown, JSON, text file, and PDF are all in the same vector space.

## Files Referenced

| File | Purpose |
|------|---------|
| `apps/mcp-server/src/services/ingest.ts` | Text ingestion: read → hash → chunk → embed → store |
| `apps/mcp-server/src/services/embeddings.ts` | Embedding via OpenRouter |
| `apps/mcp-server/src/services/queue.ts` | BullMQ enqueue for multimodal files |
| `apps/rag-worker/lib/worker.py` | Python worker: PDF/image processing + text fallback |
| `apps/rag-worker/scripts/ingest.py` | CLI script for manual ingestion |
| `supabase/migrations/002_documents.sql` | Documents table (metadata + hash) |
| `supabase/migrations/003_chunks.sql` | Chunks table (text + vector + tsvector) |
| `supabase/migrations/004_hybrid_search.sql` | Hybrid search function |
| `apps/mcp-server/src/config.ts` | chunkSize, chunkOverlap, embeddingModel config |
| `.env` | EMBEDDING_MODEL, EMBEDDING_DIMENSIONS |
| `apps/mcp-server/src/routes/index.ts` | POST /ingest route handler |
| `configs/claude/commands/ingest.md` | /ingest slash command definition |
