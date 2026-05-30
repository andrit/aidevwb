---
name: source-citation
description: Make RAG answers cite their sources precisely — extend the query pipeline to pass document names and metadata to Claude, structure prompts to require attribution, and add citation accuracy to eval
domain: rag
type: rag
triggers:
  - "source citation"
  - "cite sources"
  - "where did this answer come from"
  - "which document"
  - "attribution"
  - "hallucination"
  - "grounding"
  - "answer not backed by documents"
  - "need to know which file"
  - "verify claims"
  - "show sources"
---

# Source Citation

## When to use

When the RAG application needs to show users which documents support each claim — for trust, auditability, or anti-hallucination. Activate when the user says "it should cite which document it's using", "I need to verify where answers come from", or "the agent is making things up."

## The Problem With the Default Pipeline

The workbench's `/query` endpoint passes raw chunk content to Claude joined by `---` separators. Claude's system prompt already says "Cite which parts of the context support your answer," but because the context contains no document names, Claude can only say "the context mentions..." rather than "according to `refund-policy.md`..."

The `/query` response does return a `sources` array with `document_id` UUIDs and scores — but not filenames or titles. Bridging this gap is what this skill covers.

## Prerequisites

- Documents ingested and searchable
- Baseline eval working (see `ingest-and-validate`)
- Python or TypeScript application code where queries originate
- Understanding of what the `/query` response returns: `{answer, sources[], search_method, embedding_model, llm_model}`

## Architecture: Two-Step Citation Pipeline

The key insight is to separate retrieval from generation, so you control what context Claude sees:

```
Step 1 (Retrieve):  /query → get sources[] with document_ids + chunk content
Step 2 (Enrich):    /documents/:id → resolve document_id to filename + metadata
Step 3 (Generate):  call Claude directly with named, labeled context
```

The workbench's bundled `/query` combines steps 1+3 without step 2. To get proper named citation, you run these steps yourself.

## Step 1: Extend the Workbench API with a Document Lookup

Add a route to the MCP server that resolves document IDs to their metadata:

```typescript
// apps/mcp-server/src/routes/rag.ts — add inside registerRagRoutes()

app.get("/documents/:id", async (request, reply) => {
  const db = request.projectDb;
  if (!db) return reply.status(400).send({ error: "No project context" });

  const { id } = request.params as { id: string };
  const [doc] = await db`
    SELECT id, filepath, file_type, metadata, created_at
    FROM documents
    WHERE id = ${id}
  `;

  if (!doc) return reply.status(404).send({ error: "Document not found" });
  return doc;
});

// Batch lookup for efficiency
app.post("/documents/lookup", async (request, reply) => {
  const db = request.projectDb;
  if (!db) return reply.status(400).send({ error: "No project context" });

  const { ids } = request.body as { ids: string[] };
  if (!ids?.length) return { documents: [] };

  const docs = await db`
    SELECT id, filepath, file_type, metadata
    FROM documents
    WHERE id = ANY(${ids}::uuid[])
  `;

  return { documents: docs };
});
```

Also add a route that returns chunks with their content (needed for step 3):

```typescript
app.post("/chunks/lookup", async (request, reply) => {
  const db = request.projectDb;
  if (!db) return reply.status(400).send({ error: "No project context" });

  const { ids } = request.body as { ids: string[] };
  const chunks = await db`
    SELECT c.id, c.content, c.chunk_index, d.filepath, d.metadata
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.id = ANY(${ids}::uuid[])
  `;

  return { chunks };
});
```

## Step 2: Build the Two-Step Pipeline

```python
# app/cited_rag.py — retrieval + citation pipeline
import httpx
import anthropic
from pathlib import Path

workbench = httpx.Client(base_url="http://localhost:3100", timeout=30)
llm = anthropic.Anthropic()

CITATION_SYSTEM_PROMPT = """You are a knowledgebase assistant. Answer the user's question
based ONLY on the provided source documents.

Rules:
1. For every factual claim, cite the source using [Source: filename] notation.
2. If multiple sources support the same claim, cite all of them.
3. If the sources don't contain enough information, say "I don't have information
   about that in the available documents" — do not guess or invent.
4. Quote directly from sources when the exact wording matters.
5. At the end of your answer, list all cited sources under "Sources Used:".
"""


def query_with_citation(
    question: str,
    project: str,
    top_k: int = 5,
) -> dict:
    """
    Full citation pipeline:
    1. Retrieve top chunks (using workbench hybrid search)
    2. Resolve document names
    3. Generate answer with Claude, source-labeled context
    """
    headers = {"X-Project": project}

    # Step 1: Retrieve chunks via eval-style search (scores + chunk_ids)
    # We use /eval with a single query to get chunk content + scores
    # NOTE: In production, extend the workbench to expose a raw retrieval endpoint
    # that returns chunk content + document_id without calling Claude.
    # For now, call /query and use the sources for document lookup,
    # then call /chunks/lookup to get the actual content.
    query_resp = workbench.post("/query",
                                json={"question": question, "top_k": top_k},
                                headers=headers)
    query_resp.raise_for_status()
    query_result = query_resp.json()

    sources_meta = query_result.get("sources", [])
    if not sources_meta:
        return {
            "answer": "No relevant documents found.",
            "sources_used": [],
            "question": question,
        }

    # Step 2: Resolve chunk content + document names
    chunk_ids = [s["chunk_id"] for s in sources_meta]
    chunks_resp = workbench.post("/chunks/lookup",
                                 json={"ids": chunk_ids},
                                 headers=headers)
    chunks_resp.raise_for_status()
    chunks = {c["id"]: c for c in chunks_resp.json()["chunks"]}

    # Step 3: Build source-labeled context
    context_parts = []
    sources_used = []
    for i, source_meta in enumerate(sources_meta):
        chunk = chunks.get(source_meta["chunk_id"])
        if not chunk:
            continue
        # Use just the filename, not the full path — cleaner in citations
        filename = Path(chunk["filepath"]).name
        context_parts.append(
            f"[Source {i+1}: {filename}]\n{chunk['content']}"
        )
        sources_used.append({
            "source_num": i + 1,
            "filename": filename,
            "filepath": chunk["filepath"],
            "chunk_id": source_meta["chunk_id"],
            "hybrid_score": source_meta["hybrid_score"],
        })

    labeled_context = "\n\n---\n\n".join(context_parts)

    # Step 4: Generate answer with Claude + citation instructions
    response = llm.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=CITATION_SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": f"Source documents:\n\n{labeled_context}\n\nQuestion: {question}",
        }],
    )

    answer = response.content[0].text

    return {
        "question": question,
        "answer": answer,
        "sources_used": sources_used,
        "chunk_count": len(context_parts),
    }
```

Example output:

```json
{
  "question": "What is the refund policy?",
  "answer": "Our refund policy allows returns within 30 days of purchase [Source: refund-policy.md]. For digital products, refunds are available within 48 hours [Source: digital-products-faq.md]. To initiate a refund, contact support@example.com [Source: refund-policy.md].\n\nSources Used:\n- refund-policy.md\n- digital-products-faq.md",
  "sources_used": [
    {"source_num": 1, "filename": "refund-policy.md", "hybrid_score": 0.541},
    {"source_num": 2, "filename": "digital-products-faq.md", "hybrid_score": 0.423}
  ],
  "chunk_count": 2
}
```

## Step 3: Add Citation Accuracy to Eval

Extend your eval queries to check that source names appear in the answer:

```json
{
  "name": "citation-accuracy-v1",
  "queries": [
    {
      "question": "What is the refund policy?",
      "min_score": 0.3,
      "expected_keywords": ["refund", "30 days"],
      "expected_source_mentions": ["refund-policy"]
    }
  ],
  "top_k": 5
}
```

The built-in eval doesn't check `expected_source_mentions` — you need to add that check in your application's test suite:

```python
# tests/test_citation.py
from app.cited_rag import query_with_citation

def test_refund_policy_cites_source():
    result = query_with_citation(
        "What is the refund policy?",
        project="my-project",
    )
    assert "refund-policy" in result["answer"].lower(), (
        f"Answer should cite refund-policy.md but got:\n{result['answer']}"
    )
    assert any(
        s["filename"] == "refund-policy.md"
        for s in result["sources_used"]
    ), "refund-policy.md should appear in sources_used"

def test_answer_stays_grounded():
    """Answer should admit it doesn't know rather than hallucinate."""
    result = query_with_citation(
        "What is the quantum entanglement policy?",  # doesn't exist
        project="my-project",
    )
    lower = result["answer"].lower()
    assert any(phrase in lower for phrase in [
        "don't have information",
        "not available",
        "not found",
        "no information",
    ]), f"Expected 'I don't know' response but got:\n{result['answer']}"
```

## Strengthening the Anti-Hallucination Constraint

The citation system prompt above is a baseline. For higher-stakes applications (legal, medical, financial), strengthen it:

```python
STRICT_CITATION_SYSTEM_PROMPT = """You are a document retrieval assistant.
Your ONLY function is to find and present information from the provided source documents.

STRICT RULES:
1. Only make claims that are directly supported by a quoted passage from the sources.
2. Use exact quotes where possible: "according to [Source: X], '...exact text...'"
3. If asked about something not in the sources, respond:
   "This topic is not covered in the available documents."
   Never speculate, extrapolate, or use general knowledge.
4. Never say "typically", "generally", "usually" — these imply knowledge
   beyond what the sources say.
5. If sources conflict, present both versions and name both sources.
"""
```

## Workbench Limitation Note

The current workbench `/query` endpoint does not expose a raw retrieval endpoint that returns chunk content without calling Claude. The `chunks/lookup` endpoint described above requires you to add two routes to `apps/mcp-server/src/routes/rag.ts`. Without those additions, you must use the workaround of calling `/query` for the source list, then running a second database query for chunk content.

A future workbench improvement would be a `/retrieve` endpoint that returns ranked chunks with content and document metadata, without the Claude generation step — enabling full control over the generation prompt.

## Checklist

- [ ] `/documents/lookup` and `/chunks/lookup` routes added to `apps/mcp-server/src/routes/rag.ts`
- [ ] `cited_rag.py` (or equivalent) implements two-step pipeline: retrieve → enrich → generate
- [ ] Context passed to Claude includes `[Source N: filename]` labels
- [ ] System prompt explicitly requires citation notation `[Source: filename]`
- [ ] System prompt has explicit "I don't know" instruction for out-of-scope questions
- [ ] At least one test verifies source name appears in answer
- [ ] At least one test verifies grounded behavior (no hallucination) on out-of-scope query
- [ ] `sources_used` returned alongside `answer` so the caller can show a citations list

## Files involved

| File | Action |
|------|--------|
| `apps/mcp-server/src/routes/rag.ts` | Add `/documents/lookup` and `/chunks/lookup` routes |
| `app/cited_rag.py` | Create: two-step pipeline with source labeling |
| `tests/test_citation.py` | Create: citation accuracy + anti-hallucination tests |

## Common mistakes

**Relying on the default `/query` for citation** — the workbench's bundled pipeline passes unnamed chunk content to Claude. The system prompt says "cite which parts," but without filenames in the context, Claude invents generic citations like "the document states..." Build the two-step pipeline to get real source names.

**Showing chunk IDs as citations** — UUIDs are not useful to users. Map every `document_id` or `chunk_id` to the human-readable filename before building the context. The `/chunks/lookup` extension provides this.

**No "I don't know" behavior** — without an explicit "if not in sources, say so" instruction, Claude will use its training knowledge to fill gaps. For a grounded RAG app, this is hallucination. The instruction must be explicit and tested.

**Not testing citation on questions you know the answer to** — test citation with questions where you know exactly which file should be cited. If the answer cites the wrong file, either retrieval is returning the wrong chunks or the system prompt isn't specific enough.
