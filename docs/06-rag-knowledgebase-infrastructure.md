# RAG/MCP Infrastructure — Building a Knowledgebase

## What RAG Is

Retrieval-Augmented Generation (RAG) is a pattern where an LLM answers questions by first **retrieving** relevant information from a knowledge store, then **generating** an answer grounded in that retrieved context. The LLM doesn't rely on its training data alone — it reads your documents.

Without RAG, an LLM only knows what it was trained on. With RAG, it knows your specific documents: your codebase, your company handbook, your API specs, your meeting notes.

The "retrieval" part turns natural language questions into database queries. The "generation" part turns database results into human answers.

## The RAG Pipeline

```
                    INGESTION (offline, once per document)
                    ─────────────────────────────────────
Document → Read → Hash (SHA256) → Chunk → Embed → Store
   │         │         │             │        │       │
   │       text      dedup       500-char  vector   Supabase
   │      content    check       pieces   1024-dim   pgvector
   │                                                  + tsvector


                    RETRIEVAL (online, every query)
                    ───────────────────────────────
Question → Embed → Hybrid Search → Rank → Top-K Chunks
   │         │          │            │         │
  text    vector    cosine sim    weighted   5 best
         1024-dim   + ts_rank     70/30     matches


                    GENERATION (online, every query)
                    ────────────────────────────────
Top-K Chunks → Context Assembly → Claude → Answer
                     │                        │
              concatenated             grounded in
                chunks               retrieved text
```

## Every Component Explained

### 1. Document Reading

**What:** Read the raw content of a file (text, PDF, image).

**Where:** `apps/mcp-server/src/services/ingest.ts` (text files) and `apps/rag-worker/lib/worker.py` (multimodal).

**How:** Text files are read with `readFile()`. PDFs and images go to the Python worker which uses RAG-Anything for multimodal extraction (tables, charts, images → text).

### 2. SHA256 Hashing

**What:** Compute a cryptographic hash of the file content. If the hash matches an existing document, skip ingestion entirely.

**Why:** Embedding API calls cost money. Re-embedding an unchanged 50-page PDF wastes time and tokens. The SHA256 hash is a unique fingerprint — if the content hasn't changed, the hash is identical.

**Where:** `apps/mcp-server/src/services/ingest.ts` line:

```typescript
const contentHash = createHash("sha256").update(fileBuffer).digest("hex");

const { data: existing } = await supabase
  .from("documents")
  .select("id")
  .eq("content_hash", contentHash);

if (existing && existing.length > 0) {
  return { status: "skipped", reason: "unchanged (SHA256 match)" };
}
```

**Database:** `documents.content_hash` column with a unique index (`supabase/migrations/002_documents.sql`).

### 3. Chunking

**What:** Split long documents into smaller pieces (chunks) that fit within the embedding model's context window and provide focused retrieval results.

**Why:** Embedding models have token limits, and more importantly, smaller chunks produce more precise retrieval. A 50-page document as a single embedding would match too many queries vaguely. 500-character chunks match specific questions precisely.

**Configuration:**
- `chunkSize: 500` — characters per chunk
- `chunkOverlap: 50` — overlapping characters between chunks

The overlap prevents information loss at chunk boundaries. If a sentence spans two chunks, the overlap ensures it appears (at least partially) in both.

**Where:** `apps/mcp-server/src/services/ingest.ts`:

```typescript
function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = start + size;
    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
  }
  return chunks;
}
```

### 4. Embedding

**What:** Convert text into a high-dimensional vector (array of floating-point numbers). Semantically similar texts produce vectors that are close together in vector space.

**How:** The workbench sends text to OpenRouter's embedding API, which proxies to the configured model (default: Voyage voyage-3, producing 1024-dimensional vectors).

**Where:** `apps/mcp-server/src/services/embeddings.ts`:

```typescript
const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: config.openrouterApiKey,
});

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const response = await client.embeddings.create({
    model: config.embeddingModel,  // "voyage/voyage-3"
    input: texts,
  });
  return response.data.map((item) => item.embedding);
}
```

**Result:** Each chunk becomes a `vector(1024)` — an array of 1024 floats.

### 5. Storage

**What:** Store the document metadata, chunk text, vector embeddings, and full-text search vectors in PostgreSQL.

**Where:**

**Document record** (`supabase/migrations/002_documents.sql`):
```sql
CREATE TABLE documents (
  id              uuid PRIMARY KEY,
  title           text NOT NULL,
  source_type     text NOT NULL,      -- "txt", "pdf", "md"
  source_path     text,               -- "/workspace/documents/file.txt"
  content_hash    text NOT NULL,      -- SHA256 hex
  metadata        jsonb,              -- { filename, size_bytes, chunk_count, ... }
  created_at      timestamptz,
  updated_at      timestamptz
);
```

**Chunk record** (`supabase/migrations/003_chunks.sql`):
```sql
CREATE TABLE document_chunks (
  id              uuid PRIMARY KEY,
  document_id     uuid REFERENCES documents(id) ON DELETE CASCADE,
  content         text NOT NULL,           -- The chunk text
  embedding       vector(1024),            -- pgvector embedding
  search_vector   tsvector,                -- Full-text search index
  chunk_index     integer,                 -- Order within document
  metadata        jsonb,
  created_at      timestamptz
);
```

Two search indexes:
- `idx_chunks_embedding` — IVFFlat index for fast cosine similarity search
- `idx_chunks_search_vector` — GIN index for fast full-text keyword search

### 6. Hybrid Search

**What:** Combine vector similarity (semantic meaning) with keyword matching (exact terms) to find the most relevant chunks.

**Why hybrid?** Pure vector search is great for semantic similarity ("What's the return policy?" matches "refund procedures") but misses exact terms (searching for "E-4012" needs keyword matching, not semantic similarity). Pure keyword search finds exact matches but misses semantic connections. Combining both covers all cases.

**Where:** `supabase/migrations/004_hybrid_search.sql`:

```sql
CREATE FUNCTION hybrid_search(
  query_embedding   vector(1024),
  query_text        text,
  match_threshold   float DEFAULT 0.5,
  match_count       int DEFAULT 5,
  vector_weight     float DEFAULT 0.7,
  text_weight       float DEFAULT 0.3
)
```

The function computes:
```
hybrid_score = 0.7 × cosine_similarity(embedding, query) + 0.3 × ts_rank(tsvector, query)
```

- **Cosine similarity** (`1 - (embedding <=> query_embedding)`): measures semantic closeness (0 to 1, where 1 is identical meaning)
- **ts_rank**: PostgreSQL's full-text search ranking function, measuring keyword relevance

Results are sorted by `hybrid_score` descending, limited to `match_count` results.

**Called from:** `apps/mcp-server/src/services/search.ts`:

```typescript
const { data } = await supabase.rpc("hybrid_search", {
  query_embedding: queryEmbedding,
  query_text: question,
  match_threshold: 0.5,
  match_count: topK,
  vector_weight: 0.7,
  text_weight: 0.3,
});
```

### 7. Answer Generation

**What:** Feed the retrieved chunks as context to Claude, which generates a grounded answer.

**Where:** `apps/mcp-server/src/services/llm.ts`:

```typescript
const response = await client.messages.create({
  model: config.claudeModel,
  max_tokens: 2048,
  system: "You are a knowledgebase assistant. Answer based ONLY on the provided context...",
  messages: [{
    role: "user",
    content: `Context:\n${context}\n\nQuestion: ${question}`,
  }],
});
```

The system prompt constrains Claude to only use the retrieved context, not its training data. This prevents hallucination — if the answer isn't in the retrieved chunks, Claude says so.

## Database Schema Diagram

```
┌─────────────────────────────────────┐
│ documents                           │
├─────────────────────────────────────┤
│ id          uuid PK                 │
│ title       text                    │
│ source_type text                    │
│ source_path text                    │
│ content_hash text UNIQUE            │──── SHA256 dedup
│ metadata    jsonb                   │
│ created_at  timestamptz             │
│ updated_at  timestamptz             │──── auto-updated trigger
└──────────────┬──────────────────────┘
               │ 1:N
               ▼
┌─────────────────────────────────────┐
│ document_chunks                     │
├─────────────────────────────────────┤
│ id           uuid PK                │
│ document_id  uuid FK → documents.id │──── CASCADE DELETE
│ content      text                   │
│ embedding    vector(1024)           │──── IVFFlat index (cosine)
│ search_vector tsvector              │──── GIN index (full-text)
│ chunk_index  integer                │
│ metadata     jsonb                  │
│ created_at   timestamptz            │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ hybrid_search() RPC function        │
│ Parameters: embedding, text,        │
│   threshold, count, weights         │
│ Returns: id, doc_id, content,       │
│   similarity, text_rank,            │
│   hybrid_score                      │
└─────────────────────────────────────┘
```

## The Queue System

**Why a queue:** PDF processing can take 30 seconds to 5 minutes. You don't want to hold an HTTP connection open that long. The queue pattern:
1. API receives request → enqueues job → responds immediately (`status: queued`)
2. Python worker polls the queue → processes the document → stores results
3. Client checks status via `/status` (queue depth) or queries the knowledgebase

**Where:**
- Enqueue: `apps/mcp-server/src/services/queue.ts`
- Process: `apps/rag-worker/lib/worker.py`
- Queue backend: Redis + BullMQ

```
mcp-server                    Redis                    rag-worker
────────────                  ─────                    ──────────
POST /ingest
  → .pdf detected
  → enqueue("ingest", {filepath})
                         bull:ingest:wait ──▸ poll_queue()
                                              → process_ingest(filepath)
                                              → embed + store
                                              → job complete
```

## Embedding Model Configuration

The workbench uses OpenRouter as an embedding proxy. Swap models by changing two environment variables:

```bash
# In .env
EMBEDDING_MODEL=voyage/voyage-3       # Model identifier
EMBEDDING_DIMENSIONS=1024             # Output dimensions
```

After changing dimensions, you must update the database:

```sql
ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(NEW_DIMS);
-- Recreate hybrid_search() with vector(NEW_DIMS) parameter
```

Then reindex: `/reindex` in Claude Code or `POST /reindex` with `{confirm: true}`.

## Walkthrough: Full Knowledgebase Lifecycle

### Step 1 — Drop documents into the documents directory

```bash
cp ~/my-project-docs/*.md documents/
cp ~/api-specs/openapi.yaml documents/
```

### Step 2 — Ingest all of them

Inside Claude Code:
```
> /ingest documents/getting-started.md
> /ingest documents/api-reference.md
> /ingest documents/openapi.yaml
```

Or via curl in a loop:
```bash
for f in documents/*; do
  curl -s -X POST http://localhost:3100/ingest \
    -H "Content-Type: application/json" \
    -d "{\"filepath\": \"/workspace/$f\"}"
  echo ""
done
```

### Step 3 — Check the knowledgebase

```bash
curl -s http://localhost:3100/status | python3 -m json.tool
```

### Step 4 — Query

```
> /query How do I authenticate API requests?
> /query What are the rate limits?
> /query Show me the error codes and their meanings
```

### Step 5 — Update a document

Edit `documents/api-reference.md`, then re-ingest:
```
> /ingest documents/api-reference.md
```

The SHA256 hash has changed, so the system ingests the new version.

### Step 6 — Backup for portability

```bash
make backup
```

## Files Referenced

| File | Purpose |
|------|---------|
| `apps/mcp-server/src/services/ingest.ts` | Full text ingestion pipeline |
| `apps/mcp-server/src/services/search.ts` | Hybrid search orchestration |
| `apps/mcp-server/src/services/embeddings.ts` | OpenRouter embedding client |
| `apps/mcp-server/src/services/llm.ts` | Claude answer generation |
| `apps/mcp-server/src/services/queue.ts` | BullMQ job queue |
| `apps/rag-worker/lib/worker.py` | Python multimodal worker |
| `supabase/migrations/001_extensions.sql` | pgvector + pg_trgm extensions |
| `supabase/migrations/002_documents.sql` | Documents table |
| `supabase/migrations/003_chunks.sql` | Chunks table with vector + tsvector |
| `supabase/migrations/004_hybrid_search.sql` | Hybrid search SQL function |
| `.env` | EMBEDDING_MODEL, EMBEDDING_DIMENSIONS |
| `configs/claude/commands/ingest.md` | /ingest slash command |
| `configs/claude/commands/query.md` | /query slash command |
| `configs/claude/commands/status.md` | /status slash command |
| `configs/claude/commands/reindex.md` | /reindex slash command |
