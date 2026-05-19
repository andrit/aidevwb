/**
 * Redis connection factory.
 *
 * Provides named connections for different subsystems:
 *   - "bullmq" for job queues (used by queue.ts)
 *   - "bus" for the message bus (used by bus.ts)
 *   - "general" for ad-hoc operations
 *
 * Each name gets its own IORedis instance. Connections are cached.
 */
import IORedis from "ioredis";
import { config } from "../config.js";

const connections = new Map<string, IORedis>();

export function getRedis(name = "general"): IORedis {
  if (!connections.has(name)) {
    connections.set(
      name,
      new IORedis(config.redisUrl, { maxRetriesPerRequest: null })
    );
  }
  return connections.get(name)!;
}

export async function closeAllRedis(): Promise<void> {
  const closing = [...connections.values()].map((c) => c.quit());
  await Promise.all(closing);
  connections.clear();
}
