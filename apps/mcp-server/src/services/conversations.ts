/**
 * Conversation service — multi-turn history management.
 *
 * Stores conversations and messages in the project database.
 * Each conversation is a thread of messages with roles (user, assistant, system, tool).
 * Designed for chatbot/agent projects that need context across turns.
 *
 * All functions receive a Db connection — project-scoped via middleware.
 */
import type { Db } from "./db.js";
import type {
  Conversation,
  Message,
  CreateConversationInput,
  CreateMessageInput,
} from "../schemas/index.js";

export async function listConversations(
  db: Db,
  limit = 20,
  offset = 0
): Promise<Conversation[]> {
  const rows = await db`
    SELECT c.id, c.title, c.metadata, c.created_at::text, c.updated_at::text,
           (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) as message_count
    FROM conversations c
    ORDER BY c.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows as unknown as Conversation[];
}

export async function getConversation(
  db: Db,
  id: string
): Promise<Conversation | null> {
  const rows = await db`
    SELECT c.id, c.title, c.metadata, c.created_at::text, c.updated_at::text,
           (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) as message_count
    FROM conversations c
    WHERE c.id = ${id}
  `;
  return rows.length > 0 ? (rows[0] as unknown as Conversation) : null;
}

export async function createConversation(
  db: Db,
  input: CreateConversationInput
): Promise<Conversation> {
  const rows = await db`
    INSERT INTO conversations (title)
    VALUES (${input.title ?? null})
    RETURNING id, title, metadata, created_at::text, updated_at::text
  `;
  const conversation = rows[0] as unknown as Conversation;
  conversation.message_count = 0;

  // Seed initial messages if provided
  if (input.messages && input.messages.length > 0) {
    await appendMessages(db, conversation.id, input.messages);
    conversation.message_count = input.messages.length;
  }

  return conversation;
}

export async function deleteConversation(
  db: Db,
  id: string
): Promise<boolean> {
  const result = await db`
    DELETE FROM conversations WHERE id = ${id}
  `;
  return result.count > 0;
}

export async function getMessages(
  db: Db,
  conversationId: string,
  limit = 100
): Promise<Message[]> {
  const rows = await db`
    SELECT id, conversation_id, role, content, metadata, created_at::text
    FROM messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
  return rows as unknown as Message[];
}

export async function appendMessages(
  db: Db,
  conversationId: string,
  messages: CreateMessageInput[]
): Promise<Message[]> {
  const inserted: Message[] = [];

  for (const msg of messages) {
    const rows = await db`
      INSERT INTO messages (conversation_id, role, content, metadata)
      VALUES (
        ${conversationId},
        ${msg.role},
        ${msg.content},
        ${JSON.stringify(msg.metadata ?? {})}::jsonb
      )
      RETURNING id, conversation_id, role, content, metadata, created_at::text
    `;
    inserted.push(rows[0] as unknown as Message);
  }

  // Touch the conversation's updated_at
  await db`UPDATE conversations SET updated_at = now() WHERE id = ${conversationId}`;

  return inserted;
}

/**
 * Build a context string from conversation history.
 * Useful for feeding into an LLM as conversation context.
 */
export function formatConversationContext(messages: Message[]): string {
  return messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");
}
