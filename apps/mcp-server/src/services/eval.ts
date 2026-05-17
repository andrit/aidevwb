/**
 * Eval service — search quality measurement.
 *
 * Runs a set of test queries against the knowledgebase, scores each result,
 * and computes aggregate metrics. Used to tune search weights,
 * compare embedding models, and validate knowledgebase quality.
 *
 * Metrics:
 *   - pass rate: % of queries where top result exceeds min_score
 *   - avg top score: mean of the best hybrid_score per query
 *   - MRR (Mean Reciprocal Rank): how high relevant results appear
 *   - keyword coverage: % of expected keywords found in retrieved chunks
 */
import type { Db } from "./db.js";
import { embedSingle } from "./embeddings.js";
import { config } from "../config.js";
import type { EvalQuery, EvalQueryResult, EvalRunResult } from "../schemas/index.js";

export async function runEval(
  db: Db,
  name: string,
  queries: EvalQuery[],
  topK: number = 5
): Promise<EvalRunResult> {
  const results: EvalQueryResult[] = [];
  let reciprocalRankSum = 0;

  for (const query of queries) {
    const result = await evaluateSingleQuery(db, query, topK);
    results.push(result);

    // MRR: if passed, reciprocal rank is 1/(rank of first good result)
    // For simplicity, we use 1/1 if top result passes, 0 if not
    if (result.passed) {
      reciprocalRankSum += 1; // top-1 match
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const avgTopScore =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.top_score, 0) / results.length
      : 0;
  const mrr = results.length > 0 ? reciprocalRankSum / results.length : 0;

  const summary: EvalRunResult = {
    name,
    total_queries: results.length,
    passed,
    failed: results.length - passed,
    avg_top_score: round(avgTopScore),
    mrr: round(mrr),
    results,
  };

  // Store eval run in database for historical tracking
  await db`
    INSERT INTO eval_runs (query_set_name, results, summary)
    VALUES (${name}, ${JSON.stringify(results)}::jsonb, ${JSON.stringify(summary)}::jsonb)
  `;

  return summary;
}

async function evaluateSingleQuery(
  db: Db,
  query: EvalQuery,
  topK: number
): Promise<EvalQueryResult> {
  const queryEmbedding = await embedSingle(query.question);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const data = await db`
    SELECT id, document_id, content, similarity, text_rank, hybrid_score
    FROM hybrid_search(
      ${embeddingStr}::vector,
      ${query.question},
      ${0.0},
      ${topK},
      ${config.vectorWeight},
      ${config.textWeight}
    )
  `;

  if (!data || data.length === 0) {
    return {
      question: query.question,
      top_score: 0,
      top_chunk_preview: "(no results)",
      passed: false,
      ...(query.expected_keywords
        ? { keyword_hits: 0, keyword_total: query.expected_keywords.length }
        : {}),
      ...(query.expected_document_id !== undefined
        ? { expected_doc_found: false }
        : {}),
    };
  }

  const topResult = data[0];
  const topScore = Number(topResult.hybrid_score);
  const topContent = String(topResult.content);
  const preview =
    topContent.length > 150
      ? topContent.slice(0, 150) + "..."
      : topContent;

  // Check keyword coverage
  let keywordHits: number | undefined;
  let keywordTotal: number | undefined;
  if (query.expected_keywords && query.expected_keywords.length > 0) {
    const allContent = data.map((r) => String(r.content).toLowerCase()).join(" ");
    keywordTotal = query.expected_keywords.length;
    keywordHits = query.expected_keywords.filter((kw) =>
      allContent.includes(kw.toLowerCase())
    ).length;
  }

  // Check expected document
  let expectedDocFound: boolean | undefined;
  if (query.expected_document_id) {
    expectedDocFound = data.some(
      (r) => String(r.document_id) === query.expected_document_id
    );
  }

  const passed = topScore >= query.min_score;

  return {
    question: query.question,
    top_score: round(topScore),
    top_chunk_preview: preview,
    passed,
    ...(keywordHits !== undefined ? { keyword_hits: keywordHits } : {}),
    ...(keywordTotal !== undefined ? { keyword_total: keywordTotal } : {}),
    ...(expectedDocFound !== undefined ? { expected_doc_found: expectedDocFound } : {}),
  };
}

/**
 * Get historical eval runs for comparison.
 */
export async function listEvalRuns(
  db: Db,
  limit = 10
): Promise<Array<{ id: string; query_set_name: string; summary: unknown; created_at: string }>> {
  const rows = await db`
    SELECT id, query_set_name, summary, created_at::text
    FROM eval_runs
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as Array<{
    id: string;
    query_set_name: string;
    summary: unknown;
    created_at: string;
  }>;
}

function round(n: number, places = 4): number {
  return Number(n.toFixed(places));
}
