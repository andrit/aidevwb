/**
 * Message Bus Schemas — inter-agent communication.
 *
 * Channels are project-scoped. Messages are JSON with a sender,
 * content (any JSON), and a sequential ID for cursor-based polling.
 */
import { z } from "zod";

export const ChannelNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w.-]+$/, "Alphanumeric, dots, hyphens, underscores")
  .describe("Channel name (e.g. 'planning', 'results', 'agent-to-agent')");

export const BusPublishSchema = z.object({
  channel: ChannelNameSchema,
  sender: z.string().min(1).describe("Sender identifier (agent name or role)"),
  content: z.unknown().describe("Message content (any JSON)"),
  metadata: z.record(z.unknown()).optional().describe("Optional metadata"),
});
export type BusPublishInput = z.infer<typeof BusPublishSchema>;

export const BusReadSchema = z.object({
  channel: ChannelNameSchema,
  since_id: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Return messages after this ID (0 = all recent). Use for polling."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum messages to return"),
});
export type BusReadInput = z.infer<typeof BusReadSchema>;

export const BusChannelsSchema = z.object({
  prefix: z.string().optional().describe("Filter channels by prefix"),
});
export type BusChannelsInput = z.infer<typeof BusChannelsSchema>;

export const BusMessageSchema = z.object({
  id: z.number().int(),
  channel: z.string(),
  sender: z.string(),
  content: z.unknown(),
  metadata: z.record(z.unknown()).nullable(),
  timestamp: z.string(),
});
export type BusMessage = z.infer<typeof BusMessageSchema>;

export const BusChannelInfoSchema = z.object({
  name: z.string(),
  message_count: z.number().int(),
  last_message_at: z.string().nullable(),
});
export type BusChannelInfo = z.infer<typeof BusChannelInfoSchema>;
