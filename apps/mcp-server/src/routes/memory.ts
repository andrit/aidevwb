/**
 * Memory routes — agent persistent key-value store.
 *
 * PUT    /memory/:key  — set a value (upsert)
 * GET    /memory/:key  — get a value
 * DELETE /memory/:key  — delete a value
 * GET    /memory       — list keys (optional ?prefix=)
 *
 * All routes require project context (via middleware).
 */
import { FastifyInstance } from "fastify";
import { MemorySetSchema } from "../schemas/index.js";
import {
  memorySet,
  memoryGet,
  memoryDelete,
  memoryList,
} from "../services/memory.js";

export async function registerMemoryRoutes(
  app: FastifyInstance
): Promise<void> {

  app.put("/memory/:key", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const { key } = request.params as { key: string };
    const body = request.body as Record<string, unknown> | null;
    const input = { key, value: body?.value, metadata: body?.metadata as Record<string, unknown> | undefined };

    const parsed = MemorySetSchema.safeParse(input);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    const entry = await memorySet(db, parsed.data.key, parsed.data.value, parsed.data.metadata);
    return entry;
  });

  app.get("/memory/:key", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const { key } = request.params as { key: string };
    const entry = await memoryGet(db, key);
    if (!entry) {
      return reply.status(404).send({ error: `Memory key '${key}' not found` });
    }
    return entry;
  });

  app.delete("/memory/:key", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const { key } = request.params as { key: string };
    const deleted = await memoryDelete(db, key);
    if (!deleted) {
      return reply.status(404).send({ error: `Memory key '${key}' not found` });
    }
    return { status: "deleted", key };
  });

  app.get("/memory", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const { prefix } = request.query as { prefix?: string };
    return memoryList(db, prefix);
  });
}
