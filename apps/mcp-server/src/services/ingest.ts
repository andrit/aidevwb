/**
 * Document ingestion with SHA256 change detection.
 *
 * Receives a Db connection — does not know which project it's targeting.
 * Text files are processed inline. Multimodal files go to the queue.
 *
 * Uses extracted utilities: lib/chunker.ts, lib/hash.ts.
 */
import { readFile, stat } from "fs/promises";
import { basename, extname } from "path";
import { config } from "../config.js";
import { embedTexts } from "./embeddings.js";
import { enqueueIngest } from "./queue.js";
import { chunkText } from "../lib/chunker.js";
import { sha256 } from "../lib/hash.js";
import type { Db } from "./db.js";
import type { IngestResult } from "../schemas/index.js";

const MULTIMODAL_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".tiff",
]);
const BATCH_SIZE = 100;

export async function ingestDocument(
  db: Db,
  filepath: string
): Promise<IngestResult> {
  try {
    await stat(filepath);
  } catch {
    return { status: "error", reason: `File not found: ${filepath}` };
  }

  const ext = extname(filepath).toLowerCase();

  if (MULTIMODAL_EXTENSIONS.has(ext)) {
    const jobId = await enqueueIngest(filepath);
    return {
      status: "queued",
      reason: "Multimodal file queued for rag-worker",
      job_id: jobId,
    };
  }

  return ingestTextFile(db, filepath);
}

async function ingestTextFile(
  db: Db,
  filepath: string
): Promise<IngestResult> {
  // SHA256 change detection
  const fileBuffer = await readFile(filepath);
  const contentHash = sha256(fileBuffer);

  const existing = await db`
    SELECT id FROM documents WHERE content_hash = ${contentHash}
  `;

  if (existing.length > 0) {
    return {
      status: "skipped",
      reason: "unchanged (SHA256 match)",
      document_id: existing[0].id,
      content_hash: contentHash,
    };
  }

  // Read and chunk
  const text = fileBuffer.toString("utf-8");
  const chunks = chunkText(text, {
    size: config.chunkSize,
    overlap: config.chunkOverlap,
  });
  const filename = basename(filepath);
  const sourceType = extname(filepath).replace(".", "") || "txt";

  // Store document record
  const docRows = await db`
    INSERT INTO documents (title, source_type, source_path, content_hash, metadata)
    VALUES (
      ${basename(filepath, extname(filepath))},
      ${sourceType},
      ${filepath},
      ${contentHash},
      ${JSON.stringify({
        filename,
        size_bytes: fileBuffer.length,
        chunk_count: chunks.length,
        embedding_model: config.embeddingModel,
      })}::jsonb
    )
    RETURNING id
  `;

  if (docRows.length === 0) {
    return { status: "error", reason: "Failed to create document record" };
  }

  const docId = docRows[0].id as string;

  // Embed and store chunks in batches
  let totalStored = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const embeddings = await embedTexts(batch);

    const rows = batch.map((content, j) => ({
      document_id: docId,
      content,
      embedding: `[${embeddings[j].join(",")}]`,
      chunk_index: i + j,
      metadata: JSON.stringify({ chunk_size: content.length }),
    }));

    for (const row of rows) {
      await db`
        INSERT INTO document_chunks (document_id, content, embedding, chunk_index, metadata)
        VALUES (
          ${row.document_id},
          ${row.content},
          ${row.embedding}::vector,
          ${row.chunk_index},
          ${row.metadata}::jsonb
        )
      `;
      totalStored++;
    }
  }

  return {
    status: "ingested",
    document_id: docId,
    chunks: totalStored,
    content_hash: contentHash,
  };
}
