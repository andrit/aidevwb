/**
 * Message Bus — Redis-backed inter-agent communication.
 *
 * Uses Redis lists for message history (capped per channel)
 * and Redis sets for channel tracking. Project-scoped via key prefix.
 *
 * Design notes:
 *   - MCP tools are request-response, not streaming. Agents poll
 *     with bus_read(since_id) to get new messages.
 *   - Messages are stored as JSON in Redis lists, newest last.
 *   - Each message gets a sequential ID (per-channel counter).
 *   - Channel history is capped at MAX_MESSAGES_PER_CHANNEL.
 *
 * Key format:
 *   bus:{project}:{channel}          — list of JSON messages
 *   bus:{project}:{channel}:id       — auto-increment counter
 *   bus:{project}:__channels__       — set of known channel names
 */
import { getRedis } from "./redis.js";
import { withSpan, spanAttrs } from "../lib/tracing.js";
import type { BusMessage, BusChannelInfo } from "../schemas/index.js";

const MAX_MESSAGES_PER_CHANNEL = 1000;

function channelKey(project: string, channel: string): string {
  return `bus:${project}:${channel}`;
}
function counterKey(project: string, channel: string): string {
  return `bus:${project}:${channel}:id`;
}
function channelSetKey(project: string): string {
  return `bus:${project}:__channels__`;
}

/**
 * Publish a message to a channel.
 * Creates the channel if it doesn't exist.
 */
export async function busPublish(
  project: string,
  channel: string,
  sender: string,
  content: unknown,
  metadata?: Record<string, unknown>
): Promise<BusMessage> {
  return withSpan(
    "bus.publish",
    { ...spanAttrs.agentTool(project, "bus_publish"), "bus.channel": channel, "bus.sender": sender },
    async (span) => {
      const redis = getRedis("bus");

      // Increment message ID
      const id = await redis.incr(counterKey(project, channel));

      const message: BusMessage = {
        id,
        channel,
        sender,
        content,
        metadata: metadata ?? null,
        timestamp: new Date().toISOString(),
      };

      const key = channelKey(project, channel);

      // Push message and cap the list
      await redis.rpush(key, JSON.stringify(message));
      await redis.ltrim(key, -MAX_MESSAGES_PER_CHANNEL, -1);

      // Track channel in the project's channel set
      await redis.sadd(channelSetKey(project), channel);

      // Notify live subscribers via Redis pub/sub
      await pubsubNotify(project, channel, message);

      span.setAttribute("bus.message_id", id);
      return message;
    }
  );
}

/**
 * Read messages from a channel, optionally filtering by since_id.
 * Returns messages with ID > since_id, up to limit.
 */
export async function busRead(
  project: string,
  channel: string,
  sinceId = 0,
  limit = 20
): Promise<BusMessage[]> {
  return withSpan(
    "bus.read",
    { ...spanAttrs.agentTool(project, "bus_read"), "bus.channel": channel, "bus.since_id": sinceId },
    async (span) => {
      const redis = getRedis("bus");
      const key = channelKey(project, channel);

      // Read all messages (up to cap), then filter client-side
      // This is efficient because the list is capped at MAX_MESSAGES_PER_CHANNEL
      const raw = await redis.lrange(key, 0, -1);

      const messages: BusMessage[] = [];
      for (const item of raw) {
        try {
          const msg = JSON.parse(item) as BusMessage;
          if (msg.id > sinceId) {
            messages.push(msg);
            if (messages.length >= limit) break;
          }
        } catch {
          // Skip malformed messages
        }
      }

      span.setAttribute("bus.messages_returned", messages.length);
      return messages;
    }
  );
}

/**
 * List active channels for a project.
 */
export async function busListChannels(
  project: string,
  prefix?: string
): Promise<BusChannelInfo[]> {
  const redis = getRedis("bus");
  let channels = await redis.smembers(channelSetKey(project));

  if (prefix) {
    channels = channels.filter((c) => c.startsWith(prefix));
  }

  const result: BusChannelInfo[] = [];
  for (const name of channels.sort()) {
    const key = channelKey(project, name);
    const count = await redis.llen(key);

    // Get last message timestamp
    let lastAt: string | null = null;
    if (count > 0) {
      const lastRaw = await redis.lindex(key, -1);
      if (lastRaw) {
        try {
          lastAt = (JSON.parse(lastRaw) as BusMessage).timestamp;
        } catch {
          // ignore
        }
      }
    }

    result.push({
      name,
      message_count: count,
      last_message_at: lastAt,
    });
  }

  return result;
}

/**
 * Clear all messages from a channel.
 */
export async function busClearChannel(
  project: string,
  channel: string
): Promise<boolean> {
  const redis = getRedis("bus");
  const key = channelKey(project, channel);
  const deleted = await redis.del(key, counterKey(project, channel));
  await redis.srem(channelSetKey(project), channel);
  return deleted > 0;
}

/**
 * Clear all channels for a project.
 */
export async function busClearProject(project: string): Promise<number> {
  const redis = getRedis("bus");
  const channels = await redis.smembers(channelSetKey(project));

  let count = 0;
  for (const channel of channels) {
    await redis.del(channelKey(project, channel), counterKey(project, channel));
    count++;
  }
  await redis.del(channelSetKey(project));

  return count;
}

// ═══════════════════════════════════════════════════════════
// Streaming subscription — for standalone agents (NOT MCP tools)
//
// Standalone agents (AutoGen, CrewAI, etc.) run their own event loops
// and can hold a live Redis pub/sub subscription. This is more efficient
// than polling — messages arrive instantly.
//
// MCP tools are request-response (Claude Code is turn-based), so they
// use busRead() with polling. Standalone agents should use subscribe().
// ═══════════════════════════════════════════════════════════

const PUBSUB_PREFIX = "bus:pubsub:";

function pubsubChannel(project: string, channel: string): string {
  return `${PUBSUB_PREFIX}${project}:${channel}`;
}

/**
 * Publish also emits on Redis pub/sub so live subscribers get instant delivery.
 * Called internally by busPublish() — not a separate user-facing function.
 */
async function pubsubNotify(project: string, channel: string, message: BusMessage): Promise<void> {
  // Use a separate connection for publishing (pub/sub connections are modal in Redis)
  const redis = getRedis("bus");
  await redis.publish(pubsubChannel(project, channel), JSON.stringify(message));
}

/**
 * Subscribe to a channel with a callback. Returns an unsubscribe function.
 *
 * For standalone agents (Python, Node) — NOT for MCP tools.
 * The subscriber receives messages in real-time via Redis pub/sub.
 *
 * Usage (in a standalone agent):
 *   const unsub = await busSubscribe("nexus", "planning", (msg) => {
 *     console.log(`${msg.sender}: ${msg.content}`);
 *   });
 *   // ... later ...
 *   await unsub();
 */
export async function busSubscribe(
  project: string,
  channel: string,
  callback: (message: BusMessage) => void
): Promise<() => Promise<void>> {
  // Pub/sub requires a dedicated connection (Redis enters subscriber mode)
  const sub = getRedis("bus-subscriber");
  const key = pubsubChannel(project, channel);

  const handler = (_channel: string, raw: string) => {
    try {
      const msg = JSON.parse(raw) as BusMessage;
      callback(msg);
    } catch {
      // skip malformed
    }
  };

  await sub.subscribe(key);
  sub.on("message", handler);

  // Return unsubscribe function
  return async () => {
    sub.off("message", handler);
    await sub.unsubscribe(key);
  };
}
