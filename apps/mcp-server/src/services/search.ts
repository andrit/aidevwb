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
import { withSpan, spanAttrs } from "../lib/tracing.js";
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
  return withSpan(
    "rag.hybrid_search",
    { ...spanAttrs.rag("", "hybrid_search"), "search.question_length": question.length },
    async (span) => {
      const topK = options.topK ?? config.matchCount;
      const vectorWeight = options.vectorWeight ?? config.vectorWeight;
      const textWeight = options.textWeight ?? config.textWeight;
      const matchThreshold = options.matchThreshold ?? config.matchThreshold;

      span.setAttribute("search.top_k", topK);
      span.setAttribute("search.vector_weight", vectorWeight);
      span.setAttribute("search.text_weight", textWeight);

      // Embed the question (child span created inside embedSingle)
      const queryEmbedding = await embedSingle(question);
      const embeddingStr = `[${queryEmbedding.join(",")}]`;

      // Call hybrid search function (database query)
      const data = await withSpan(
        "db.hybrid_search",
        { "db.operation": "hybrid_search", "db.top_k": topK },
        async (dbSpan) => {
          const result = await db`
            SELECT * FROM hybrid_search(
              ${embeddingStr}::vector,
              ${question},
              ${matchThreshold},
              ${topK},
              ${vectorWeight},
              ${textWeight}
            )
          `;
          dbSpan.setAttribute("db.result_count", result.length);
          return result;
        }
      );

      if (!data || data.length === 0) {
        span.setAttribute("search.results", 0);
        return {
          answer: "No relevant documents found in the knowledgebase.",
          sources: [],
          search_method: "hybrid",
          embedding_model: config.embeddingModel,
          llm_model: config.claudeModel,
        };
      }

      span.setAttribute("search.results", data.length);
      span.setAttribute("search.top_score", Number(Number(data[0].hybrid_score).toFixed(4)));

      const sources = data.map((chunk) => ({
        chunk_id: String(chunk.id),
        document_id: String(chunk.document_id),
        similarity: Number(Number(chunk.similarity).toFixed(4)),
        text_rank: Number(Number(chunk.text_rank).toFixed(4)),
        hybrid_score: Number(Number(chunk.hybrid_score).toFixed(4)),
      }));

      const context = data.map((chunk) => chunk.content).join("\n\n---\n\n");

      // Generate answer (child span created inside generateAnswer)
      const answer = await generateAnswer(question, context);
      span.setAttribute("search.answer_length", answer.length);

      return {
        answer,
        sources,
        search_method: "hybrid",
        embedding_model: config.embeddingModel,
        llm_model: config.claudeModel,
      };
    }
  );
}
