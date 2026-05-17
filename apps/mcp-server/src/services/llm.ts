/**
 * LLM client — Claude via Anthropic SDK.
 * Direct connection, no proxy. Lowest latency, full feature access.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

export async function generateAnswer(question: string, context: string): Promise<string> {
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 2048,
    system:
      "You are a knowledgebase assistant. Answer the user's question " +
      "based ONLY on the provided context. If the context doesn't " +
      "contain enough information to answer fully, say so clearly. " +
      "Cite which parts of the context support your answer.",
    messages: [
      {
        role: "user",
        content: `Context:\n${context}\n\nQuestion: ${question}`,
      },
    ],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

export async function summarizeForIngestion(text: string): Promise<string> {
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `Summarize this document in 2-3 sentences. Focus on key topics and entities.\n\n${text.slice(0, 3000)}`,
      },
    ],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}
