/**
 * Eval Schemas — search quality measurement.
 *
 * A query set is a list of test queries with expected results.
 * The eval runner executes each query, scores retrieval quality,
 * and produces aggregate metrics (MRR, precision@k, recall).
 */
import { z } from "zod";

export const EvalQuerySchema = z.object({
  question: z.string().min(1).describe("Test query"),
  expected_keywords: z
    .array(z.string())
    .optional()
    .describe("Keywords that should appear in retrieved chunks"),
  expected_document_id: z
    .string()
    .optional()
    .describe("Document ID that should be in the results"),
  min_score: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .describe("Minimum hybrid score to consider a match"),
});
export type EvalQuery = z.infer<typeof EvalQuerySchema>;

export const RunEvalSchema = z.object({
  name: z.string().min(1).describe("Name for this eval run (e.g. 'baseline', 'after-reindex')"),
  queries: z.array(EvalQuerySchema).min(1).describe("Test queries to evaluate"),
  top_k: z.number().min(1).max(20).default(5).describe("Chunks to retrieve per query"),
});
export type RunEvalInput = z.infer<typeof RunEvalSchema>;

export const EvalQueryResultSchema = z.object({
  question: z.string(),
  top_score: z.number(),
  top_chunk_preview: z.string(),
  keyword_hits: z.number().optional(),
  keyword_total: z.number().optional(),
  expected_doc_found: z.boolean().optional(),
  passed: z.boolean(),
});
export type EvalQueryResult = z.infer<typeof EvalQueryResultSchema>;

export const EvalRunResultSchema = z.object({
  name: z.string(),
  total_queries: z.number(),
  passed: z.number(),
  failed: z.number(),
  avg_top_score: z.number(),
  mrr: z.number().describe("Mean Reciprocal Rank — how high the best match ranks on average"),
  results: z.array(EvalQueryResultSchema),
});
export type EvalRunResult = z.infer<typeof EvalRunResultSchema>;
