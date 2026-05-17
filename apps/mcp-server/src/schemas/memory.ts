/**
 * Memory Schemas — persistent key-value state for agents.
 *
 * Keys are namespaced strings (e.g., "agent:preferences", "user:profile").
 * Values are arbitrary JSON. This is not RAG — it's structured state
 * that agents read/write across sessions.
 */
import { z } from "zod";

export const MemoryKeySchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[\w:./-]+$/, "Alphanumeric, colons, dots, slashes, hyphens")
  .describe("Memory key (e.g. 'agent:preferences', 'user:name')");

export const MemorySetSchema = z.object({
  key: MemoryKeySchema,
  value: z.unknown().describe("Any JSON value to store"),
  metadata: z.record(z.unknown()).optional().describe("Optional metadata"),
});
export type MemorySetInput = z.infer<typeof MemorySetSchema>;

export const MemoryGetSchema = z.object({
  key: MemoryKeySchema,
});
export type MemoryGetInput = z.infer<typeof MemoryGetSchema>;

export const MemoryDeleteSchema = z.object({
  key: MemoryKeySchema,
});
export type MemoryDeleteInput = z.infer<typeof MemoryDeleteSchema>;

export const MemoryListSchema = z.object({
  prefix: z.string().optional().describe("Filter keys by prefix (e.g. 'agent:')"),
});
export type MemoryListInput = z.infer<typeof MemoryListSchema>;

export const MemoryEntrySchema = z.object({
  key: z.string(),
  value: z.unknown(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;
