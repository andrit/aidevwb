/**
 * Embedding client via OpenRouter.
 *
 * Uses the OpenAI SDK pointed at OpenRouter's endpoint.
 * Swap models by changing EMBEDDING_MODEL in .env — no code changes.
 */
import OpenAI from "openai";
import { config } from "../config.js";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: config.openrouterApiKey,
});

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await client.embeddings.create({
    model: config.embeddingModel,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}

export async function embedSingle(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}
