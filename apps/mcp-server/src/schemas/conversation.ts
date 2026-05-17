/**
 * Conversation Schemas — multi-turn history for chatbot/agent projects.
 */
import { z } from "zod";

export const MessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const CreateMessageSchema = z.object({
  role: MessageRoleSchema.describe("Message role"),
  content: z.string().min(1).describe("Message content"),
  metadata: z.record(z.unknown()).optional().describe("Optional metadata (tool call results, etc.)"),
});
export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;

export const CreateConversationSchema = z.object({
  title: z.string().optional().describe("Conversation title (auto-generated if omitted)"),
  messages: z.array(CreateMessageSchema).optional().describe("Initial messages to seed the conversation"),
});
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;

export const AppendMessagesSchema = z.object({
  messages: z.array(CreateMessageSchema).min(1).describe("Messages to append"),
});
export type AppendMessagesInput = z.infer<typeof AppendMessagesSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: MessageRoleSchema,
  content: z.string(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  message_count: z.number().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;
