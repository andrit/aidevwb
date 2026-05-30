---
name: query-rewriting
description: Improve RAG retrieval by preprocessing user questions into better search queries — expansion, decomposition, HyDE, and sub-query planning — before calling rag_query
domain: rag
type: rag
triggers:
  - "query rewriting"
  - "the right content is there but it's not being found"
  - "search misses obvious answers"
  - "question phrasing doesn't match document phrasing"
  - "improve retrieval accuracy"
  - "query expansion"
  - "decompose complex questions"
  - "HyDE"
  - "hypothetical document embedding"
  - "broad questions return wrong results"
---

# Query Rewriting

## When to use

When the right content exists in the knowledgebase but retrieval misses it — because the user's phrasing doesn't match how the documents are written. A user asking "Can I get my money back?" and a document that says "30-day refund policy" contain the same concept in different words. Query rewriting bridges that gap before the search runs.

Apply this skill after `ingest-and-validate` shows acceptable eval scores on direct phrasing but failures on paraphrase queries.

## Prerequisites

- Documents ingested and searchable (`ingest-and-validate` done)
- At least one failing eval query where the content definitely exists but isn't being retrieved
- `ANTHROPIC_API_KEY` available (query rewriting uses a Claude call)
- Python or TypeScript application code where the RAG query originates

## The Core Insight

The workbench's `/query` endpoint takes the user's raw question, embeds it, and searches for similar chunks. This works well when the user's vocabulary matches the document's vocabulary. It fails when they don't:

```
User asks:   "Can I get my money back if I'm not happy?"
Document says: "Our 30-day satisfaction guarantee provides full refunds..."

The embedding similarity between these is lower than you'd expect.
Query rewriting fixes this before the search runs.
```

Query rewriting is an **application-layer concern** — it happens in your code before you call `rag_query`, not inside the workbench.

## The Four Techniques

### Technique 1: Query Expansion (easiest, biggest bang)

Add synonyms, related terms, and alternate phrasings to the query. The expanded query matches more chunks while still finding the most relevant ones.

```python
# query_rewriter.py
import anthropic

client = anthropic.Anthropic()

def expand_query(user_question: str) -> str:
    """
    Expand a user question with synonyms and related terms.
    Returns a single enriched query string.
    """
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",  # fast + cheap for rewriting
        max_tokens=200,
        system=(
            "You are a search query optimizer. Given a user question, "
            "rewrite it to improve retrieval from a document knowledgebase. "
            "Add relevant synonyms, related terms, and alternate phrasings. "
            "Return ONLY the rewritten query — no explanation, no preamble."
        ),
        messages=[{"role": "user", "content": f"Original question: {user_question}"}],
    )
    return response.content[0].text.strip()
```

Usage:

```python
from query_rewriter import expand_query
import httpx

def rag_query_with_expansion(user_question: str, project: str, top_k: int = 5) -> dict:
    rewritten = expand_query(user_question)

    resp = httpx.post("http://localhost:3100/query",
                      json={"question": rewritten, "top_k": top_k},
                      headers={"X-Project": project})
    result = resp.json()
    result["original_question"] = user_question
    result["rewritten_question"] = rewritten
    return result
```

**When to use:** Default technique. Use it everywhere. It adds one fast LLM call (Haiku) and consistently improves recall on paraphrase queries.

---

### Technique 2: Sub-Query Decomposition (for complex questions)

Break a multi-part question into focused sub-queries, run each independently, and merge the results. This prevents one part of the question from dominating the embedding and missing the other parts.

```python
import json

def decompose_query(user_question: str) -> list[str]:
    """
    Split a complex question into focused sub-queries.
    Returns a list of 2-4 simpler questions.
    """
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        system=(
            "You are a search query planner. Given a complex user question, "
            "break it into 2-4 focused sub-questions that together cover the full question. "
            "Each sub-question should be independently searchable. "
            "Return a JSON array of strings only — no explanation."
        ),
        messages=[{"role": "user", "content": user_question}],
    )
    try:
        return json.loads(response.content[0].text.strip())
    except json.JSONDecodeError:
        return [user_question]  # fallback to original on parse failure


def rag_query_decomposed(user_question: str, project: str, top_k_per_query: int = 3) -> dict:
    """Run sub-queries and merge deduplicated results."""
    sub_queries = decompose_query(user_question)
    seen_chunks: set[str] = set()
    all_sources = []

    for sub_q in sub_queries:
        resp = httpx.post("http://localhost:3100/query",
                          json={"question": sub_q, "top_k": top_k_per_query},
                          headers={"X-Project": project})
        result = resp.json()
        for source in result.get("sources", []):
            if source["chunk_id"] not in seen_chunks:
                seen_chunks.add(source["chunk_id"])
                all_sources.append({**source, "sub_query": sub_q})

    # Sort by hybrid_score descending, take top N
    all_sources.sort(key=lambda s: s["hybrid_score"], reverse=True)

    return {
        "original_question": user_question,
        "sub_queries": sub_queries,
        "sources": all_sources[:top_k_per_query * 2],  # merged top results
    }
```

**When to use:** Questions that contain "and", "compare", "difference between", "both X and Y". Single-embedding search can't serve two concepts at once.

---

### Technique 3: HyDE — Hypothetical Document Embedding

Instead of embedding the question, ask Claude to write a hypothetical answer, then search for chunks similar to that hypothetical answer. Documents are written as answers, so a hypothetical answer's embedding is much closer to the real document than the question's embedding.

```python
def hyde_query(user_question: str, project: str, top_k: int = 5) -> dict:
    """
    Generate a hypothetical answer, search using it, return real results.
    """
    # Step 1: generate a plausible hypothetical answer
    hyp_response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        system=(
            "Write a detailed, factual-sounding answer to the question as if it "
            "appeared in a product documentation or policy document. "
            "Do not hedge — write as a document would. "
            "Return only the hypothetical answer text."
        ),
        messages=[{"role": "user", "content": user_question}],
    )
    hypothetical_answer = hyp_response.content[0].text.strip()

    # Step 2: search using the hypothetical answer as the query
    resp = httpx.post("http://localhost:3100/query",
                      json={"question": hypothetical_answer, "top_k": top_k},
                      headers={"X-Project": project})
    result = resp.json()
    result["original_question"] = user_question
    result["hypothetical_answer_used"] = hypothetical_answer[:200] + "..."
    return result
```

**When to use:** Conceptual questions ("How does the payment system work?"), questions where the answer would be a paragraph of explanation. Less useful for exact-term lookups where keyword search already works.

---

### Technique 4: Metadata Filter Extraction (advanced)

Extract structured filters from the question and apply them before vector search. This narrows the search space to only relevant documents.

```python
def extract_filters(user_question: str) -> dict:
    """
    Extract metadata filters from the question.
    Returns a dict of filter fields.
    """
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=150,
        system=(
            "Extract search filters from a user question as JSON. "
            "Possible filters: category (string), date_after (YYYY-MM-DD), "
            "date_before (YYYY-MM-DD), author (string). "
            "Only include filters explicitly mentioned. Return {} if none found."
        ),
        messages=[{"role": "user", "content": user_question}],
    )
    try:
        return json.loads(response.content[0].text.strip())
    except json.JSONDecodeError:
        return {}
```

**Note on workbench support:** The workbench's current `hybrid_search` SQL function does not filter by document metadata at query time. Metadata is stored in the `documents` table and in chunk metadata but the hybrid search function doesn't accept filter parameters. To use metadata filtering:
1. Extract filters as shown above
2. Pass them to a custom SQL query that pre-filters documents before the vector search
3. Or use them to post-filter the returned sources list

This requires extending the search service — it's not available out of the box.

## Choosing the Right Technique

```
Is the question a simple factual lookup?
  → Use expansion (always) — small cost, consistent improvement

Is the question multi-part ("X and Y", "compare X with Y")?
  → Use decomposition — separate searches, merged results

Is the question conceptual or open-ended?
  → Use HyDE — search via hypothetical answer

Does the question mention a specific category, date, or author?
  → Use metadata filter extraction (requires search service extension)
```

For most RAG applications, **expansion is the default** and decomposition is added for complex questions. HyDE is used selectively when expansion alone doesn't close the gap.

## Measuring Impact

Run your eval set before and after adding query rewriting to measure the improvement:

```bash
# Baseline: raw questions
curl -s -X POST http://localhost:3100/eval \
  -H "Content-Type: application/json" \
  -H "X-Project: $WORKBENCH_PROJECT" \
  -d '{"name": "baseline-raw", "queries": [...], "top_k": 5}' | jq '{mrr, passed, failed}'

# After rewriting: replace questions with their rewritten versions
# (run expand_query on each, save to a new eval file)
python -c "
import json, anthropic
# ... load baseline.json, rewrite each question, save to rewritten.json
"
curl -s -X POST http://localhost:3100/eval \
  -H "Content-Type: application/json" \
  -H "X-Project: $WORKBENCH_PROJECT" \
  -d '{"name": "rewritten-v1", "queries": [...rewritten...], "top_k": 5}' | jq '{mrr, passed, failed}'
```

A well-implemented expansion typically improves MRR by 0.05–0.15 on a corpus with natural language variation.

## Checklist

- [ ] Failing eval queries identified: content exists but isn't retrieved
- [ ] Technique chosen based on query type (expansion/decomposition/HyDE)
- [ ] Rewriting happens before `rag_query` call — not inside the workbench
- [ ] Rewritten query and original both logged (for debugging retrieval failures)
- [ ] Eval run before and after — improvement measured, not assumed
- [ ] Haiku used for rewriting (not Sonnet/Opus) — keep latency and cost low
- [ ] Fallback in place: if rewriting fails (timeout, parse error), use original question

## Files involved

| File | Action |
|------|--------|
| `app/query_rewriter.py` | Create: `expand_query`, `decompose_query`, `hyde_query` |
| `app/rag_pipeline.py` | Create or update: wrap `rag_query` call with rewriting |
| `evals/rewritten-baseline.json` | Create: eval set with rewritten questions for before/after comparison |

## Common mistakes

**Using Sonnet for query rewriting** — Haiku is fast enough and 10× cheaper. Rewriting runs on every user query; cost compounds. Use Haiku for preprocessing, Sonnet/Opus for final answer generation only.

**Rewriting without measuring** — "expansion should help" is a hypothesis. Run the eval before and after. Sometimes expansion adds noise that hurts precision even while it improves recall.

**Discarding the original query** — some queries work better with their original phrasing (short exact-term queries, product names, error codes). Run both the original and the rewritten query and merge results, or choose based on query type.

**Using decomposition on simple questions** — decomposing "What is the refund policy?" into sub-queries adds latency and noise. Decomposition is for compound questions only. Add a classifier that decides whether decomposition is needed.
