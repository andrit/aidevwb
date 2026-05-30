---
name: ingest-and-validate
description: Ingest a document corpus into the RAG knowledgebase, verify ingestion with /status, run a scored eval set, interpret MRR and keyword coverage, and iterate until quality targets are met
domain: rag
type: rag
triggers:
  - "ingest documents"
  - "load my corpus"
  - "add documents to the knowledgebase"
  - "ingest and test"
  - "set up RAG"
  - "build the knowledgebase"
  - "how good is my search"
  - "check RAG quality"
  - "run eval"
  - "is ingestion working"
---

# Ingest and Validate a RAG Corpus

## When to use

When setting up a new RAG project or adding a batch of documents to an existing knowledgebase. Covers the full loop: ingest → verify → write an eval set → score → iterate. Activate when the user says "ingest my documents", "set up the RAG", "run eval", or "how do I know if it's working?"

## Prerequisites

- Workbench running: `make up`
- Project registered: `make project NAME=<project> DIR=<path>` or `make scaffold NAME=<project> TYPE=rag`
- `WORKBENCH_PROJECT=<project>` set (in `.env` or exported in shell)
- Documents available at a path accessible from within the Claude Code container (the mounted `PROJECT_DIR`)

## Steps

### 1. Verify the project is active

```bash
/status
```

Expected response:
```json
{
  "project": "<project>",
  "total_documents": 0,
  "total_chunks": 0,
  "embedding_model": "voyage/voyage-3",
  "queue_waiting": 0,
  "queue_active": 0
}
```

If `project` is wrong or missing, check that `WORKBENCH_PROJECT` is set correctly.

### 2. Ingest a single document first

Before batching, ingest one document and verify it works end to end:

```
/ingest /workspace/docs/my-first-doc.md
```

Or via slash command with a path visible to the container:

```
/ingest /project/docs/overview.pdf
```

Wait for the queue to drain, then check status:

```
/status
```

You should see `total_documents: 1` and `total_chunks` > 0. If `total_chunks` is 0 after a minute, the worker may have failed — check `make logs` for `rag-worker` errors.

**Supported file types:**
- Text: `.md`, `.txt`, `.rst`, `.html`
- Structured: `.json`, `.csv`, `.yaml`
- Multimodal (Claude-processed): `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.tiff`

### 3. Test retrieval on the single document

Before ingesting the full corpus, confirm the single document is searchable:

```
/query What does this document cover?
```

The response should reference content from the document. If it says "No relevant documents found", the embedding may have failed — run `/status` and check `total_chunks`.

### 4. Ingest the full corpus

For a directory of files:

```
/ingest /project/docs/file1.md
/ingest /project/docs/file2.md
/ingest /project/docs/guide.pdf
```

For large corpora, use a script that calls the API directly. The ingest endpoint is non-blocking (jobs are queued):

```bash
# ingest_corpus.sh — ingest all .md and .pdf files in a directory
#!/bin/bash
PROJECT_DIR="${1:?usage: ingest_corpus.sh <dir>}"
API="http://localhost:3100"
PROJECT="${WORKBENCH_PROJECT:?WORKBENCH_PROJECT not set}"

find "$PROJECT_DIR" -type f \( -name "*.md" -o -name "*.pdf" -o -name "*.txt" \) | \
while read -r file; do
  echo "Ingesting: $file"
  curl -s -X POST "$API/ingest" \
    -H "Content-Type: application/json" \
    -H "X-Project: $PROJECT" \
    -d "{\"filepath\": \"$file\"}" | jq .
done
```

Poll `/status` until `queue_waiting` and `queue_active` both reach 0:

```bash
# Wait for queue to drain
while true; do
  STATUS=$(curl -s "$API/status" -H "X-Project: $PROJECT")
  WAITING=$(echo "$STATUS" | jq .queue_waiting)
  ACTIVE=$(echo "$STATUS" | jq .queue_active)
  echo "Queue: waiting=$WAITING active=$ACTIVE"
  [ "$WAITING" -eq 0 ] && [ "$ACTIVE" -eq 0 ] && break
  sleep 5
done
echo "Ingestion complete: $(echo "$STATUS" | jq .total_documents) docs, $(echo "$STATUS" | jq .total_chunks) chunks"
```

### 5. Write an eval query set

Write 10-20 queries that represent real user questions. This is the single most important step — a good eval set catches problems that manual testing misses.

```
Good query set covers:
  - Simple factual lookups: "What is the refund policy?"
  - Semantic paraphrases: "Can I get my money back?" (same content, different phrasing)
  - Specific technical terms: "Error E-4012 resolution"
  - Cross-document synthesis: "What are the differences between plans A and B?"
  - Edge cases: "Is there a free tier?" (if mentioned only briefly)
```

The eval query format:

```json
{
  "name": "baseline-v1",
  "queries": [
    {
      "question": "What is the refund policy?",
      "min_score": 0.3,
      "expected_keywords": ["refund", "30 days", "return"]
    },
    {
      "question": "How do I reset my password?",
      "min_score": 0.3,
      "expected_keywords": ["reset", "email", "link"]
    },
    {
      "question": "What plans are available?",
      "min_score": 0.25,
      "expected_keywords": ["starter", "pro", "enterprise"]
    }
  ],
  "top_k": 5
}
```

**`min_score`**: the minimum `hybrid_score` for the top result to "pass". Start at `0.3` for a new knowledgebase — you can tighten it after tuning.

**`expected_keywords`**: words you expect to appear somewhere in the top-K retrieved chunks. Low keyword coverage means those concepts aren't in the knowledgebase or chunks are too small.

Save this as `evals/baseline.json` in your project directory.

### 6. Run the eval

```
/eval baseline-v1
```

Or with the MCP tool:

```
Use rag_eval with name "baseline-v1" and the queries from evals/baseline.json
```

Or via curl:

```bash
curl -s -X POST http://localhost:3100/eval \
  -H "Content-Type: application/json" \
  -H "X-Project: $WORKBENCH_PROJECT" \
  -d @evals/baseline.json | jq .
```

### 7. Interpret the results

Example eval output:

```json
{
  "name": "baseline-v1",
  "total_queries": 10,
  "passed": 7,
  "failed": 3,
  "avg_top_score": 0.412,
  "mrr": 0.70,
  "results": [
    {
      "question": "What is the refund policy?",
      "top_score": 0.541,
      "top_chunk_preview": "Our 30-day refund policy covers...",
      "passed": true,
      "keyword_hits": 3,
      "keyword_total": 3
    },
    {
      "question": "How do I reset my password?",
      "top_score": 0.218,
      "top_chunk_preview": "Account settings allow users to...",
      "passed": false,
      "keyword_hits": 1,
      "keyword_total": 3
    }
  ]
}
```

**Reading the scores:**

| Metric | Poor | Acceptable | Good | Excellent |
|--------|------|-----------|------|-----------|
| MRR | < 0.4 | 0.4-0.6 | 0.6-0.8 | > 0.8 |
| avg_top_score | < 0.2 | 0.2-0.35 | 0.35-0.5 | > 0.5 |
| pass rate | < 40% | 40-60% | 60-80% | > 80% |
| keyword coverage | < 40% | 40-60% | 60-80% | > 80% |

**Diagnosing failures:**

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `top_score` < 0.2 | Question wording doesn't match any chunk | Rephrase, or check that the relevant doc was ingested |
| `keyword_hits` low | Keywords not in the retrieved chunks | Chunks too small, or relevant doc missing |
| Fails on paraphrase but passes on exact query | Weak semantic retrieval | Increase vector weight (see `tune-search-quality`) |
| Score drops on technical terms | Poor keyword retrieval | Increase text weight |
| Most queries below threshold | Wrong embedding model or docs not ingested | Check `/status`, check rag-worker logs |

### 8. Test multi-source synthesis

Single-document retrieval is only half the job. Queries that require synthesizing across documents are where RAG applications commonly fail — the right chunks exist in two different files but the answer never brings them together.

Add at least 2 cross-document queries to your eval set:

```json
{
  "question": "How does the Pro plan's API limit compare to the Enterprise plan?",
  "min_score": 0.25,
  "expected_keywords": ["pro", "enterprise", "api", "limit"]
}
```

A cross-document query is working correctly when:
- `keyword_hits` includes terms from **both** source documents
- The generated answer references both documents' content (not just one)
- The `sources` array in the `/query` response shows `document_id` values from 2+ different documents

**How to verify synthesis is happening:**

```bash
curl -s -X POST http://localhost:3100/query \
  -H "Content-Type: application/json" \
  -H "X-Project: $WORKBENCH_PROJECT" \
  -d '{"question": "Compare the Pro and Enterprise plans", "top_k": 6}' | \
  jq '{answer: .answer, unique_docs: (.sources | map(.document_id) | unique | length)}'
# unique_docs should be > 1 for a cross-document query
```

If `unique_docs` is always 1 even for cross-document questions, the chunks from one document are dominating the scores. Fixes:
- Increase `top_k` (more chunks gives a better chance of pulling from multiple docs)
- Check that both source documents are actually ingested (`/status` + individual queries)
- Consider query decomposition (see `query-rewriting` skill) — search for each concept separately, then merge

**Signs synthesis is failing:**
- Answer only discusses one plan/product/concept even though the question asks to compare
- `unique_docs: 1` on every multi-document query
- Answer uses hedging ("the document mentions...") without integrating both sources

### 9. Iterate

1. Fix failing queries (ingest missing docs, adjust chunk size, tune weights)
2. Re-run the same eval set: `name: "baseline-v2"` (increment version to compare)
3. Use `GET /eval` to compare runs historically

```
/eval baseline-v2
```

A knowledgebase is ready when:
- MRR ≥ 0.7 on your eval set
- pass rate ≥ 75% at `min_score: 0.3`
- keyword coverage ≥ 70%
- At least 1 cross-document query passes with `unique_docs > 1`

## Templates

### Minimal eval query set (evals/baseline.json)

```json
{
  "name": "baseline-v1",
  "queries": [
    {
      "question": "<question that should find content in your corpus>",
      "min_score": 0.3,
      "expected_keywords": ["<key term 1>", "<key term 2>"]
    }
  ],
  "top_k": 5
}
```

### Batch ingest script

```bash
#!/bin/bash
# Usage: bash ingest_dir.sh /project/docs
DIR="${1:?directory required}"
for f in $(find "$DIR" -type f \( -name "*.md" -o -name "*.pdf" -o -name "*.txt" \)); do
  curl -s -X POST http://localhost:3100/ingest \
    -H "Content-Type: application/json" \
    -H "X-Project: ${WORKBENCH_PROJECT}" \
    -d "{\"filepath\": \"$f\"}"
  echo " ← $f"
done
```

## Checklist

- [ ] `/status` confirms project is active before ingesting
- [ ] Single document ingested and retrievable before batch ingest
- [ ] Batch ingest run; queue drained (`queue_waiting: 0, queue_active: 0`)
- [ ] At least 10 eval queries written covering: factual, paraphrase, exact term, cross-doc
- [ ] At least 2 cross-document queries included (questions requiring synthesis across 2+ files)
- [ ] Eval queries saved to `evals/<name>.json` in project directory
- [ ] First eval run named `baseline-v1` to anchor the comparison
- [ ] MRR, pass rate, and keyword coverage all at acceptable levels or issues identified
- [ ] Cross-document queries verified: `/query` response shows `unique_docs > 1` for synthesis questions
- [ ] Failing queries diagnosed (missing doc vs. score threshold vs. chunk size)
- [ ] Second eval run (`v2`) after fixes shows measurable improvement

## Files involved

| File | Action |
|------|--------|
| `evals/baseline.json` | Create: 10-20 eval queries with expected_keywords and min_score |
| `scripts/ingest_corpus.sh` | Create (if batch ingest needed): loop over files |

## Common mistakes

**Ingesting before the queue is empty** — if you run `/eval` before the queue drains, many documents won't be embedded yet and scores will be artificially low. Always wait for `queue_waiting: 0`.

**`min_score` too high for a new knowledgebase** — starting with `min_score: 0.6` on a fresh corpus will make everything "fail" even when retrieval is actually decent. Start at `0.3` and calibrate up once you understand your baseline.

**Only testing happy-path queries** — a query set of "What is X?" for every X in the docs tests recall but not precision. Add paraphrase queries ("How do I...?", "Can I...?") and questions where the answer requires synthesizing two documents.

**Not versioning eval runs** — if you use the same name every run, you overwrite history and lose the comparison baseline. Increment the version on every run where you changed something.

**No `expected_keywords`** — without keywords, the eval only tells you if the top score exceeded the threshold — not whether the right content was retrieved. A high score on the wrong chunk is a false positive. Always add at least 2 keywords per query.
