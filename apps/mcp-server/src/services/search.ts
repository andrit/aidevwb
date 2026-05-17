/**
 * Hybrid search: cosine similarity (semantic) + ts_rank (keyword).
 * Calls the hybrid_search() PostgreSQL function via direct SQL.
 *
 * Receives a Db connection — does not know which project it's querying.
 * Project resolution happens upstream in the middleware.
 */
import { config } from "../config.js";
import { embedSingle } from "./embeddings.js";
import { generateAnswer } from "./llm.js";
import type { Db } from "./db.js";
import type { QueryResult } from "../schemas/index.js";

export interface SearchOptions {
  topK?: number;
  vectorWeight?: number;
  textWeight?: number;
  matchThreshold?: number;
}

export async function hybridSearch(
  db: Db,
  question: string,
  options: SearchOptions = {}
): Promise<QueryResult> {
  const topK = options.topK ?? config.matchCount;
  const vectorWeight = options.vectorWeight ?? config.vectorWeight;
  const textWeight = options.textWeight ?? config.textWeight;
  const matchThreshold = options.matchThreshold ?? config.matchThreshold;

  // Embed the question
  const queryEmbedding = await embedSingle(question);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  // Call hybrid search function
  const data = await db`
    SELECT * FROM hybrid_search(
      ${embeddingStr}::vector,
      ${question},
      ${matchThreshold},
      ${topK},
      ${vectorWeight},
      ${textWeight}
    )
  `;

  if (!data || data.length === 0) {
    return {
      answer: "No relevant documents found in the knowledgebase.",
      sources: [],
      search_method: "hybrid",
      embedding_model: config.embeddingModel,
      llm_model: config.claudeModel,
    };
  }

  const sources = data.map((chunk) => ({
    chunk_id: String(chunk.id),
    document_id: String(chunk.document_id),
    similarity: Number(Number(chunk.similarity).toFixed(4)),
    text_rank: Number(Number(chunk.text_rank).toFixed(4)),
    hybrid_score: Number(Number(chunk.hybrid_score).toFixed(4)),
  }));

  const context = data.map((chunk) => chunk.content).join("\n\n---\n\n");

  const answer = await generateAnswer(question, context);

  return {
    answer,
    sources,
    search_method: "hybrid",
    embedding_model: config.embeddingModel,
    llm_model: config.claudeModel,
  };
}
