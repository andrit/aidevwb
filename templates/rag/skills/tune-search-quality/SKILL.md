---
name: tune-search-quality
description: Improve RAG retrieval quality by adjusting vector/keyword weights, chunk size, and overlap — with before/after eval comparison to measure each change's impact
domain: rag
type: rag
triggers:
  - "tune search quality"
  - "improve retrieval"
  - "search results are bad"
  - "wrong chunks returned"
  - "adjust chunk size"
  - "vector vs keyword weight"
  - "search isn't working well"
  - "how do I improve MRR"
  - "RAG quality is low"
  - "reindex"
  - "change embedding model"
---

# Tune Search Quality

## When to use

When the eval set shows MRR or pass rate below target, when retrieval returns the wrong chunks for specific queries, or when you want to compare embedding models. Activate when the user says "the search results are bad", "it's not finding the right content", "how do I improve the score", or "I need to change the chunk size."

See `seed-docs/rag-tuning-guide.md` for the reference guide.

## Prerequisites

- Documents ingested and `/status` shows chunks > 0 (see `ingest-and-validate` skill)
- Baseline eval set written and scored (`evals/baseline.json` exists with a named run)
- `WORKBENCH_PROJECT` set

## The Tuning Loop

Every change follows the same three-step loop:

```
1. Identify → run eval, find the low-scoring queries, diagnose the cause
2. Change → adjust one variable at a time
3. Measure → re-run eval under a new name, compare to baseline
```

**Never change two things at once** — if you adjust both chunk size and vector weight together, you can't tell which one improved (or hurt) the score.

## Knob 1: Vector/Keyword Weight

The hybrid search combines a vector (semantic) score with a keyword (BM25) score. The weights control the balance.

**Current defaults** (in `config.ts`):
```
VECTOR_WEIGHT = 0.7
TEXT_WEIGHT   = 0.3
```

**Decision guide:**

| Situation | Try |
|-----------|-----|
| Paraphrase queries fail, exact queries pass | Increase vector weight (0.8+) |
| Exact term queries fail, semantic queries pass | Increase text weight (0.4-0.5) |
| Technical terms (error codes, product IDs) not found | Increase text weight to 0.5+ |
| Conceptual/how-to queries miss related content | Increase vector weight to 0.8+ |
| Balanced general purpose corpus | Keep 0.7/0.3 default |

**How to change weights:**

The weights are env vars — change them in `.env` and restart the MCP server:

```bash
# .env
VECTOR_WEIGHT=0.8
TEXT_WEIGHT=0.2
```

```bash
docker compose restart mcp-server
```

After restart, run the eval under a new name to compare:

```bash
# Run the same query set with a new name to preserve the baseline
curl -s -X POST http://localhost:3100/eval \
  -H "Content-Type: application/json" \
  -H "X-Project: $WORKBENCH_PROJECT" \
  -d '{"name": "weights-80-20", "queries": [...same queries...], "top_k": 5}' | jq '{mrr, avg_top_score, passed, failed}'
```

**Compare results:**

```bash
# List recent eval runs to compare
curl -s "http://localhost:3100/eval?limit=5" \
  -H "X-Project: $WORKBENCH_PROJECT" | \
  jq '.[] | {name: .query_set_name, mrr: .summary.mrr, pass_rate: (.summary.passed / .summary.total_queries)}'
```

## Knob 2: Chunk Size and Overlap

Chunk size controls how much text goes into each vector embedding. Wrong chunk size is one of the most common causes of poor retrieval.

**Decision guide:**

| Content type | Recommended chunk size |
|-------------|----------------------|
| FAQ / short answers | 256-400 chars |
| Documentation / articles | 500-800 chars |
| Long technical docs | 800-1200 chars |
| Legal / policy documents | 600-1000 chars |
| Code documentation | 400-600 chars |

**Signs chunk size is wrong:**
- `keyword_hits` low but document is in the knowledgebase → chunks are splitting relevant content at boundaries → increase chunk size
- High scores on obvious queries but low on nuanced ones → chunks are too long, diluting relevance → decrease chunk size
- Chunks return partial answers that need the next chunk → increase overlap

**How to change chunk size:**

Chunk size is set at ingest time (it's an env var for the RAG worker):

```bash
# .env
CHUNK_SIZE=600
CHUNK_OVERLAP=60
```

After changing chunk size, you must **reindex** — existing chunks used the old size:

```bash
# Reindex re-embeds all documents with the current chunk settings
/reindex
```

Or via API:

```bash
curl -s -X POST http://localhost:3100/reindex \
  -H "Content-Type: application/json" \
  -H "X-Project: $WORKBENCH_PROJECT" \
  -d '{"confirm": true}'
```

Wait for the queue to drain, then run eval:

```bash
/eval chunk-600-v1
```

**Overlap rule of thumb:** overlap = 10-20% of chunk size. For `CHUNK_SIZE=600`, use `CHUNK_OVERLAP=60-120`.

## Knob 3: Embedding Model

Different embedding models have different strengths. Only change the model if weights and chunk size tuning haven't resolved quality issues — changing the model requires a full reindex.

| Model | Dimensions | Best for | Cost |
|-------|-----------|----------|------|
| `voyage/voyage-3` | 1024 | General purpose, multilingual | $0.06/M tokens |
| `openai/text-embedding-3-small` | 1536 | English, lowest cost | $0.02/M tokens |
| `openai/text-embedding-3-large` | 3072 | Best quality, highest cost | $0.13/M tokens |
| `BAAI/bge-m3` | 1024 | Open-source, good multilingual | $0.01/M tokens |

**How to change the embedding model:**

```bash
# .env
EMBEDDING_MODEL=openai/text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

After changing the model, a full reindex is required:

```bash
docker compose restart mcp-server rag-worker
/reindex
```

Wait for queue to drain, then run the baseline query set under a new name:

```bash
/eval model-oai-small-v1
```

## Knob 4: top_k in Queries

`top_k` controls how many chunks are retrieved. Increasing `top_k` improves recall at the cost of more context sent to the LLM.

```bash
# Default: top_k=5
/query How does pricing work?

# Higher recall: top_k=10 (use for complex, multi-part questions)
Use rag_query with question "How does pricing work?" and top_k 10
```

In the eval, `top_k` is set per eval run:

```json
{
  "name": "topk10-v1",
  "queries": [...],
  "top_k": 10
}
```

Increasing `top_k` will improve `keyword_coverage` metrics since more chunks are searched.

## Systematic Tuning Workflow

For a new knowledgebase with poor eval scores, follow this sequence:

```
Step 1: Run baseline eval → note MRR, pass rate, keyword coverage
Step 2: Look at the 3 worst-scoring queries → what's the top chunk? Is the right doc even in the KB?
Step 3: If missing docs → ingest them → re-eval (name: "added-docs-v2")
Step 4: If wrong chunks returned for paraphrase queries → try vector weight 0.8/0.2 → re-eval
Step 5: If exact term queries fail → try text weight 0.5/0.5 → re-eval
Step 6: If keyword_hits are low for queries where you know the content exists:
         → try increasing CHUNK_SIZE (more context per chunk) → reindex → re-eval
Step 7: If none of the above helps → try a different embedding model → reindex → re-eval
```

Stop when MRR ≥ 0.7 and pass rate ≥ 75%.

## Templates

### Comparison eval script

```bash
#!/bin/bash
# compare_evals.sh — run baseline eval at current settings and print comparison

PROJECT="${WORKBENCH_PROJECT:?}"
EVAL_FILE="${1:?usage: compare_evals.sh evals/baseline.json}"
RUN_NAME="${2:-run-$(date +%Y%m%d-%H%M)}"

curl -s -X POST http://localhost:3100/eval \
  -H "Content-Type: application/json" \
  -H "X-Project: $PROJECT" \
  -d "$(jq --arg name "$RUN_NAME" '.name = $name' "$EVAL_FILE")" | \
  jq '{
    name: .name,
    mrr: .mrr,
    avg_top_score: .avg_top_score,
    pass_rate: (.passed / .total_queries * 100 | round | tostring + "%"),
    passed: .passed,
    failed: .failed
  }'
```

### Weight tuning decision tree

```
Is MRR low?
├── Yes: are paraphrase queries failing more than exact queries?
│   ├── Yes: increase VECTOR_WEIGHT (try 0.8/0.2)
│   └── No: are technical term queries failing?
│       ├── Yes: increase TEXT_WEIGHT (try 0.5/0.5)
│       └── No: check if documents are actually ingested for failing queries
└── No (MRR is OK but keyword_coverage is low):
    └── increase CHUNK_SIZE and reindex
```

## Checklist

- [ ] Baseline eval run exists with a named version (`baseline-v1`) before making any changes
- [ ] Each tuning change made one at a time (not multiple changes simultaneously)
- [ ] Each change re-evaluated under a new name for comparison
- [ ] `GET /eval` used to compare runs side-by-side
- [ ] Reindex run after any change to `CHUNK_SIZE`, `CHUNK_OVERLAP`, or `EMBEDDING_MODEL`
- [ ] Queue drained (`queue_waiting: 0`) before running post-change eval
- [ ] Final settings documented in `.env` with a comment explaining why

## Files involved

| File | Action |
|------|--------|
| `.env` | Modify: `VECTOR_WEIGHT`, `TEXT_WEIGHT`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, `EMBEDDING_MODEL` |
| `evals/<name>.json` | Create: versioned eval query sets for before/after comparison |
| `scripts/compare_evals.sh` | Create (optional): script to run and display eval comparison |

## Common mistakes

**Changing multiple knobs at once** — if you change both chunk size and vector weight and MRR improves, you don't know which change helped (or whether one helped and the other hurt). Change one thing, measure, decide, then change the next.

**Not reindexing after chunk size change** — the chunks in the database were created with the old `CHUNK_SIZE`. Changing the env var without reindexing means nothing changes. After any change to `CHUNK_SIZE`, `CHUNK_OVERLAP`, or `EMBEDDING_MODEL`, you must reindex.

**Using the same eval name after changes** — reusing `baseline-v1` overwrites the original run. You lose the comparison point. Always increment the version.

**Tuning on too few queries** — a 3-query eval set will give you noise, not signal. A single paraphrase query failing can swing MRR by 0.33. You need at least 10 queries (ideally 20) for eval results to be meaningful.

**Mistaking low top-K for low quality** — if `keyword_hits` is low but the document exists in the knowledgebase, try the same eval with `top_k: 10`. Low keyword coverage with `top_k: 5` might just mean the right chunk is rank 6, not that retrieval is broken.
