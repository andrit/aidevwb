/**
 * Memory service — persistent key-value store for agents.
 *
 * Unlike RAG (unstructured search), memory is structured state:
 *   agent_remember("user:name", "Alice")
 *   agent_recall("user:name") → "Alice"
 *
 * Keys are namespaced strings. Values are arbitrary JSON.
 * All functions receive a Db connection — project-scoped.
 */
import type { Db } from "./db.js";
import type { MemoryEntry } from "../schemas/index.js";

export async function memorySet(
  db: Db,
  key: string,
  value: unknown,
  metadata?: Record<string, unknown>
): Promise<MemoryEntry> {
  const rows = await db`
    INSERT INTO memories (key, value, metadata)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${JSON.stringify(metadata ?? {})}::jsonb)
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          metadata = EXCLUDED.metadata,
          updated_at = now()
    RETURNING key, value, metadata, created_at::text, updated_at::text
  `;
  return rows[0] as unknown as MemoryEntry;
}

export async function memoryGet(
  db: Db,
  key: string
): Promise<MemoryEntry | null> {
  const rows = await db`
    SELECT key, value, metadata, created_at::text, updated_at::text
    FROM memories WHERE key = ${key}
  `;
  return rows.length > 0 ? (rows[0] as unknown as MemoryEntry) : null;
}

export async function memoryDelete(
  db: Db,
  key: string
): Promise<boolean> {
  const result = await db`DELETE FROM memories WHERE key = ${key}`;
  return result.count > 0;
}

export async function memoryList(
  db: Db,
  prefix?: string
): Promise<MemoryEntry[]> {
  if (prefix) {
    const rows = await db`
      SELECT key, value, metadata, created_at::text, updated_at::text
      FROM memories
      WHERE key LIKE ${prefix + "%"}
      ORDER BY key
    `;
    return rows as unknown as MemoryEntry[];
  }

  const rows = await db`
    SELECT key, value, metadata, created_at::text, updated_at::text
    FROM memories ORDER BY key
  `;
  return rows as unknown as MemoryEntry[];
}

/**
 * Bulk set — upsert multiple key-value pairs in one call.
 * Useful for saving agent state snapshots.
 */
export async function memoryBulkSet(
  db: Db,
  entries: Array<{ key: string; value: unknown; metadata?: Record<string, unknown> }>
): Promise<number> {
  let count = 0;
  for (const entry of entries) {
    await memorySet(db, entry.key, entry.value, entry.metadata);
    count++;
  }
  return count;
}
