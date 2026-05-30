"""
BullMQ Worker — consumes jobs from Redis queues.

Handles:
  - ingest: multimodal document processing via RAG-Anything
  - reindex: re-embed all documents after model change

Uses direct psycopg2 for database access (no Supabase client).
"""
import asyncio
import json
import hashlib
import os
import sys
import uuid
from pathlib import Path

import anthropic
import psycopg2
import psycopg2.extras
from openai import OpenAI
from redis import Redis

from lib import (
    ANTHROPIC_API_KEY, EMBEDDING_BASE_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL,
    DB_URL, REDIS_URL,
    CLAUDE_MODEL, CHUNK_SIZE, CHUNK_OVERLAP,
)

# ── Clients ───────────────────────────────────────────────
anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
openrouter_client = OpenAI(
    base_url=EMBEDDING_BASE_URL,
    api_key=EMBEDDING_API_KEY,
)
redis_client = Redis.from_url(REDIS_URL, decode_responses=True)

# Register UUID adapter for psycopg2
psycopg2.extras.register_uuid()


def get_db():
    """Get a database connection. Creates a new one each time (worker is long-lived)."""
    return psycopg2.connect(DB_URL)


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

    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Check for existing
            cur.execute(
                "SELECT id FROM documents WHERE content_hash = %s",
                (file_hash,)
            )
            existing = cur.fetchone()
            if existing:
                return {
                    "status": "skipped",
                    "reason": "unchanged (SHA256 match)",
                    "document_id": str(existing["id"]),
                }

        # Try multimodal with RAG-Anything for supported types
        ext = path.suffix.lower()
        multimodal = ext in {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".tiff"}

        if multimodal:
            return _ingest_multimodal(path, file_hash, conn)
        else:
            return _ingest_text(path, file_hash, conn)
    finally:
        conn.close()


def _ingest_text(path: Path, file_hash: str, conn) -> dict:
    """Simple text ingestion with chunking."""
    text = path.read_text(encoding="utf-8", errors="replace")
    chunks = chunk_text(text)

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        doc_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO documents (id, title, source_type, source_path, content_hash, metadata)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (
                doc_id,
                path.stem,
                path.suffix.lstrip(".") or "txt",
                str(path.absolute()),
                file_hash,
                json.dumps({
                    "filename": path.name,
                    "size_bytes": path.stat().st_size,
                    "chunk_count": len(chunks),
                    "embedding_model": EMBEDDING_MODEL,
                    "processor": "text",
                }),
            )
        )

        # Batch embed and store
        BATCH = 100
        total = 0
        for i in range(0, len(chunks), BATCH):
            batch = chunks[i:i + BATCH]
            embeddings = embed_texts(batch)
            for j, (c, e) in enumerate(zip(batch, embeddings)):
                cur.execute(
                    """INSERT INTO document_chunks (document_id, content, embedding, chunk_index, metadata)
                       VALUES (%s, %s, %s::vector, %s, %s)""",
                    (
                        doc_id,
                        c,
                        str(e),
                        i + j,
                        json.dumps({"chunk_size": len(c)}),
                    )
                )
            total += len(batch)

        conn.commit()

    return {"status": "ingested", "document_id": doc_id, "chunks": total}


def _ingest_multimodal(path: Path, file_hash: str, conn) -> dict:
    """Multimodal ingestion via RAG-Anything."""
    try:
        from raganything import RAGAnything, RAGAnythingConfig
    except ImportError:
        print("RAG-Anything not available, falling back to text extraction")
        return _ingest_text(path, file_hash, conn)

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

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            doc_id = str(uuid.uuid4())
            cur.execute(
                """INSERT INTO documents (id, title, source_type, source_path, content_hash, metadata)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (
                    doc_id,
                    path.stem,
                    path.suffix.lstrip("."),
                    str(path.absolute()),
                    file_hash,
                    json.dumps({
                        "filename": path.name,
                        "processor": "rag-anything",
                        "embedding_model": EMBEDDING_MODEL,
                        "multimodal": True,
                    }),
                )
            )

            summary = await rag.aquery(
                "Comprehensive summary covering all topics in this document."
            )
            if summary:
                emb = (await embed_func([summary]))[0]
                cur.execute(
                    """INSERT INTO document_chunks (document_id, content, embedding, chunk_index, metadata)
                       VALUES (%s, %s, %s::vector, %s, %s)""",
                    (
                        doc_id,
                        summary,
                        str(emb),
                        0,
                        json.dumps({"type": "summary", "processor": "rag-anything"}),
                    )
                )

            conn.commit()

        return {"status": "ingested", "document_id": doc_id}

    return asyncio.run(_run())


def process_reindex() -> dict:
    """Re-embed all documents. Called after embedding model change."""
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, source_path FROM documents")
            docs = cur.fetchall()

        if not docs:
            return {"status": "complete", "reindexed": 0}

        # Delete all existing chunks and documents
        with conn.cursor() as cur:
            for doc in docs:
                cur.execute("DELETE FROM document_chunks WHERE document_id = %s", (doc["id"],))
                cur.execute("DELETE FROM documents WHERE id = %s", (doc["id"],))
            conn.commit()

        # Re-ingest each document
        results = []
        for doc in docs:
            source = doc.get("source_path", "")
            if source and Path(source).exists():
                result = process_ingest(source)
                results.append(result)

        return {
            "status": "complete",
            "reindexed": len(results),
            "results": results,
        }
    finally:
        conn.close()


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
