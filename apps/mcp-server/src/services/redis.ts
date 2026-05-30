/**
 * Redis connection factory.
 *
 * Two interfaces:
 *   getRedis(name)       — returns an IORedis instance (for bus, debug, general)
 *   getRedisConfig()     — returns a plain config object (for BullMQ)
 *
 * BullMQ bundles its own ioredis internally. Passing our ioredis instance
 * causes type conflicts across versions. Instead, give BullMQ a plain
 * {host, port, password} config and let it create its own connection.
 */
import IORedis from "ioredis";
import { config } from "../config.js";

const connections = new Map<string, IORedis>();

/**
 * Get an IORedis instance for direct Redis operations (bus, debug, pub/sub).
 * NOT for BullMQ — use getRedisConfig() instead.
 */
export function getRedis(name = "general"): IORedis {
  if (!connections.has(name)) {
    connections.set(
      name,
      new IORedis(config.redisUrl, { maxRetriesPerRequest: null })
    );
  }
  return connections.get(name)!;
}

/**
 * Get a plain Redis connection config for BullMQ.
 * BullMQ creates its own ioredis instance from this — no version conflicts.
 */
export function getRedisConfig(): { host: string; port: number; password?: string; maxRetriesPerRequest: null } {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}

export async function closeAllRedis(): Promise<void> {
  const closing = [...connections.values()].map((c) => c.quit());
  await Promise.all(closing);
  connections.clear();
}
