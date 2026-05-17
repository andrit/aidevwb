/**
 * Conversation routes — multi-turn history management.
 *
 * POST   /conversations              — create a conversation
 * GET    /conversations              — list conversations
 * GET    /conversations/:id          — get conversation + messages
 * DELETE /conversations/:id          — delete conversation
 * POST   /conversations/:id/messages — append messages
 *
 * All routes require project context (via middleware).
 */
import { FastifyInstance } from "fastify";
import {
  CreateConversationSchema,
  AppendMessagesSchema,
} from "../schemas/index.js";
import {
  listConversations,
  getConversation,
  createConversation,
  deleteConversation,
  getMessages,
  appendMessages,
} from "../services/conversations.js";

export async function registerConversationRoutes(
  app: FastifyInstance
): Promise<void> {

  app.post("/conversations", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const parsed = CreateConversationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }
    const conversation = await createConversation(db, parsed.data);
    return reply.status(201).send(conversation);
  });

  app.get("/conversations", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const { limit, offset } = request.query as { limit?: string; offset?: string };
    return listConversations(db, Number(limit) || 20, Number(offset) || 0);
  });

  app.get("/conversations/:id", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const { id } = request.params as { id: string };
    const conversation = await getConversation(db, id);
    if (!conversation) {
      return reply.status(404).send({ error: "Conversation not found" });
    }

    const messages = await getMessages(db, id);
    return { ...conversation, messages };
  });

  app.delete("/conversations/:id", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const { id } = request.params as { id: string };
    const deleted = await deleteConversation(db, id);
    if (!deleted) {
      return reply.status(404).send({ error: "Conversation not found" });
    }
    return { status: "deleted" };
  });

  app.post("/conversations/:id/messages", async (request, reply) => {
    const db = request.projectDb;
    if (!db) return reply.status(400).send({ error: "No project context" });

    const { id } = request.params as { id: string };
    const parsed = AppendMessagesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.format() });
    }

    const conversation = await getConversation(db, id);
    if (!conversation) {
      return reply.status(404).send({ error: "Conversation not found" });
    }

    const messages = await appendMessages(db, id, parsed.data.messages);
    return messages;
  });
}
