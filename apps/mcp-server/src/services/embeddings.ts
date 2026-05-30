/**
 * Embedding client — provider-agnostic OpenAI-compatible endpoint.
 *
 * Defaults to local Ollama (http://ollama:11434/v1, model: mxbai-embed-large).
 * Switch provider by setting EMBEDDING_BASE_URL + EMBEDDING_API_KEY + EMBEDDING_MODEL in .env.
 *
 * Voyage AI:  EMBEDDING_BASE_URL=https://api.voyageai.com/v1  EMBEDDING_API_KEY=va-...  EMBEDDING_MODEL=voyage-3
 * OpenRouter: EMBEDDING_BASE_URL=https://openrouter.ai/api/v1  EMBEDDING_API_KEY=sk-or-...  EMBEDDING_MODEL=openai/text-embedding-3-small
 */
import OpenAI from "openai";
import { config } from "../config.js";
import { withSpan, spanAttrs } from "../lib/tracing.js";

const client = new OpenAI({
  baseURL: config.embeddingBaseUrl,
  apiKey: config.embeddingApiKey,
});

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  return withSpan(
    "embedding.batch",
    spanAttrs.embedding(config.embeddingModel, texts.length),
    async (span) => {
      const response = await client.embeddings.create({
        model: config.embeddingModel,
        input: texts,
      });

      span.setAttribute("embedding.dimensions", response.data[0]?.embedding.length ?? 0);
      span.setAttribute("embedding.total_tokens", response.usage?.total_tokens ?? 0);

      return response.data.map((item) => item.embedding);
    }
  );
}

export async function embedSingle(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}
