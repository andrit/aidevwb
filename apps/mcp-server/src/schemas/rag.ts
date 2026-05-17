/**
 * RAG Schemas — ingest, query, status, reindex.
 * Single source of truth: validates HTTP, generates MCP tool defs, infers TS types.
 */
import { z } from "zod";

// ── Ingest ────────────────────────────────────────────────
export const IngestSchema = z.object({
  filepath: z.string().describe(
    "Path to file inside the container (e.g. /workspace/documents/file.txt)"
  ),
});
export type IngestInput = z.infer<typeof IngestSchema>;

export const IngestResultSchema = z.object({
  status: z.enum(["ingested", "skipped", "queued", "error"]),
  document_id: z.string().uuid().optional(),
  chunks: z.number().optional(),
  content_hash: z.string().optional(),
  reason: z.string().optional(),
  job_id: z.string().optional(),
});
export type IngestResult = z.infer<typeof IngestResultSchema>;

// ── Query ─────────────────────────────────────────────────
export const QuerySchema = z.object({
  question: z.string().min(1).describe("The question to answer from the knowledgebase"),
  top_k: z.number().min(1).max(20).default(5).describe("Number of chunks to retrieve"),
});
export type QueryInput = z.infer<typeof QuerySchema>;

export const QueryResultSchema = z.object({
  answer: z.string(),
  sources: z.array(
    z.object({
      chunk_id: z.string(),
      document_id: z.string(),
      similarity: z.number(),
      text_rank: z.number(),
      hybrid_score: z.number(),
    })
  ),
  search_method: z.string(),
  embedding_model: z.string(),
  llm_model: z.string(),
});
export type QueryResult = z.infer<typeof QueryResultSchema>;

// ── Status ────────────────────────────────────────────────
export const StatusResultSchema = z.object({
  project: z.string(),
  total_documents: z.number(),
  total_chunks: z.number(),
  embedding_model: z.string(),
  embedding_dimensions: z.number(),
  queue_waiting: z.number().optional(),
  queue_active: z.number().optional(),
});
export type StatusResult = z.infer<typeof StatusResultSchema>;

// ── Reindex ───────────────────────────────────────────────
export const ReindexSchema = z.object({
  confirm: z.boolean().default(false).describe(
    "Must be true to proceed — this re-embeds everything"
  ),
});
export type ReindexInput = z.infer<typeof ReindexSchema>;
