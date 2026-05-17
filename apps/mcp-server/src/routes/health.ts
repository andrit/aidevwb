/**
 * Health route — Docker healthcheck + basic info.
 * Not project-scoped. Always available.
 */
import { FastifyInstance } from "fastify";
import { config } from "../config.js";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    embedding_model: config.embeddingModel,
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  }));
}
