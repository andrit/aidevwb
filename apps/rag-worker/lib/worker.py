"""
BullMQ Worker — consumes jobs from Redis queues.

Handles:
  - ingest: multimodal document processing via RAG-Anything
  - reindex: re-embed all documents after model change
"""
import asyncio
import json
import hashlib
import os
import sys
from pathlib import Path

import anthropic
from openai import OpenAI
from supabase import create_client
from redis import Redis

from lib import (
    ANTHROPIC_API_KEY, OPENROUTER_API_KEY, EMBEDDING_MODEL,
    SUPABASE_URL, SUPABASE_SERVICE_KEY, REDIS_URL,
    CLAUDE_MODEL, CHUNK_SIZE, CHUNK_OVERLAP,
)

# ── Clients ───────────────────────────────────────────────
anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
openrouter_client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY,
)
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
redis_client = Redis.from_url(REDIS_URL, decode_responses=True)


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    resp = openrouter_client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [item.embedding for item in resp.data]


def sha256_of_file(filepath: str) -> str:
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        for block in iter(lambda: f.read(8192), b""):
            hasher.update(block)
    return hasher.hexdigest()


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        end = start + size
        c = text[start:end].strip()
        if c:
            chunks.append(c)
        start = end - overlap
    return chunks


def process_ingest(filepath: str) -> dict:
    """Ingest a document — handles both text and multimodal."""
    path = Path(filepath)
    if not path.exists():
        return {"status": "error", "reason": f"File not found: {filepath}"}

    file_hash = sha256_of_file(filepath)

    # Check for existing
    existing = supabase.table("documents") \
        .select("id").eq("content_hash", file_hash).execute()
    if existing.data:
        return {
            "status": "skipped",
            "reason": "unchanged (SHA256 match)",
            "document_id": existing.data[0]["id"],
        }

    # Try multimodal with RAG-Anything for supported types
    ext = path.suffix.lower()
    multimodal = ext in {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".tiff"}

    if multimodal:
        return _ingest_multimodal(path, file_hash)
    else:
        return _ingest_text(path, file_hash)


def _ingest_text(path: Path, file_hash: str) -> dict:
    """Simple text ingestion with chunking."""
    text = path.read_text(encoding="utf-8", errors="replace")
    chunks = chunk_text(text)

    doc = supabase.table("documents").insert({
        "title": path.stem,
        "source_type": path.suffix.lstrip(".") or "txt",
        "source_path": str(path.absolute()),
        "content_hash": file_hash,
        "metadata": {
            "filename": path.name,
            "size_bytes": path.stat().st_size,
            "chunk_count": len(chunks),
            "embedding_model": EMBEDDING_MODEL,
            "processor": "text",
        }
    }).execute()
    doc_id = doc.data[0]["id"]

    # Batch embed and store
    BATCH = 100
    total = 0
    for i in range(0, len(chunks), BATCH):
        batch = chunks[i:i + BATCH]
        embeddings = embed_texts(batch)
        rows = [{
            "document_id": doc_id,
            "content": c,
            "embedding": e,
            "chunk_index": i + j,
            "metadata": {"chunk_size": len(c)},
        } for j, (c, e) in enumerate(zip(batch, embeddings))]
        supabase.table("document_chunks").insert(rows).execute()
        total += len(rows)

    return {"status": "ingested", "document_id": doc_id, "chunks": total}


def _ingest_multimodal(path: Path, file_hash: str) -> dict:
    """Multimodal ingestion via RAG-Anything."""
    try:
        from raganything import RAGAnything, RAGAnythingConfig
    except ImportError:
        # Fallback to text extraction
        print("RAG-Anything not available, falling back to text extraction")
        return _ingest_text(path, file_hash)

    async def _run():
        async def llm_func(prompt, **kwargs) -> str:
            resp = anthropic_client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
            return resp.content[0].text

        async def embed_func(texts: list[str]) -> list[list[float]]:
            return embed_texts(texts)

        config = RAGAnythingConfig(working_dir="/app/rag_storage")
        rag = RAGAnything(
            config=config, llm_model_func=llm_func, embedding_func=embed_func
        )
        output_dir = f"/app/rag_storage/parsed/{path.stem}"
        await rag.process_document_complete(str(path), output_dir)

        doc = supabase.table("documents").insert({
            "title": path.stem,
            "source_type": path.suffix.lstrip("."),
            "source_path": str(path.absolute()),
            "content_hash": file_hash,
            "metadata": {
                "filename": path.name,
                "processor": "rag-anything",
                "embedding_model": EMBEDDING_MODEL,
                "multimodal": True,
            }
        }).execute()
        doc_id = doc.data[0]["id"]

        summary = await rag.aquery(
            "Comprehensive summary covering all topics in this document."
        )
        if summary:
            emb = (await embed_func([summary]))[0]
            supabase.table("document_chunks").insert({
                "document_id": doc_id,
                "content": summary,
                "embedding": emb,
                "chunk_index": 0,
                "metadata": {"type": "summary", "processor": "rag-anything"},
            }).execute()

        return {"status": "ingested", "document_id": doc_id}

    return asyncio.run(_run())


def process_reindex() -> dict:
    """Re-embed all documents. Called after embedding model change."""
    docs = supabase.table("documents").select("id,source_path").execute()
    if not docs.data:
        return {"status": "complete", "reindexed": 0}

    # Delete all existing chunks
    for doc in docs.data:
        supabase.table("document_chunks") \
            .delete().eq("document_id", doc["id"]).execute()
        # Also delete the document to reset hash
        supabase.table("documents").delete().eq("id", doc["id"]).execute()

    # Re-ingest each document
    results = []
    for doc in docs.data:
        source = doc.get("source_path", "")
        if source and Path(source).exists():
            result = process_ingest(source)
            results.append(result)

    return {
        "status": "complete",
        "reindexed": len(results),
        "results": results,
    }


def poll_queue():
    """
    Simple BullMQ-compatible queue polling.
    Listens on 'bull:ingest:wait' and 'bull:reindex:wait' lists.
    """
    print("🔄 RAG Worker started — listening for jobs...")
    print(f"   Embedding model: {EMBEDDING_MODEL}")
    print(f"   Redis: {REDIS_URL}")

    while True:
        try:
            # Block-pop from ingest and reindex queues (BullMQ stores jobs in Redis lists)
            # Try to pop a job from the wait list
            job_data = redis_client.brpoplpush(
                "bull:ingest:wait", "bull:ingest:active", timeout=5
            )
            if job_data:
                try:
                    job = json.loads(redis_client.hget(f"bull:ingest:{job_data}", "data") or "{}")
                    filepath = job.get("filepath", "")
                    if filepath:
                        print(f"📄 Processing ingest job: {filepath}")
                        result = process_ingest(filepath)
                        print(f"   Result: {result.get('status')}")
                except Exception as e:
                    print(f"   ❌ Ingest job failed: {e}")
                finally:
                    redis_client.lrem("bull:ingest:active", 1, job_data)
                continue

            # Check reindex queue
            reindex_data = redis_client.brpoplpush(
                "bull:reindex:wait", "bull:reindex:active", timeout=5
            )
            if reindex_data:
                try:
                    print("🔄 Processing reindex job...")
                    result = process_reindex()
                    print(f"   Reindexed: {result.get('reindexed')} documents")
                except Exception as e:
                    print(f"   ❌ Reindex job failed: {e}")
                finally:
                    redis_client.lrem("bull:reindex:active", 1, reindex_data)

        except KeyboardInterrupt:
            print("\n👋 Worker shutting down")
            break
        except Exception as e:
            print(f"⚠️  Worker error: {e}")
            import time
            time.sleep(5)


if __name__ == "__main__":
    poll_queue()
