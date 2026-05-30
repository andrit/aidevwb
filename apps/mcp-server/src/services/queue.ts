/**
 * Job queue — BullMQ on Redis.
 *
 * The MCP server enqueues ingestion jobs; the Python rag-worker
 * consumes them via its own BullMQ-compatible worker.
 * The TS side can also process simple text ingestion directly.
 *
 * Uses getRedisConfig() (plain config object) instead of getRedis()
 * (ioredis instance) because BullMQ bundles its own ioredis version.
 * Passing an external ioredis instance causes type conflicts.
 */
import { Queue } from "bullmq";
import { getRedisConfig } from "./redis.js";

let _ingestQueue: Queue | null = null;
let _reindexQueue: Queue | null = null;

export function getIngestQueue(): Queue {
  if (!_ingestQueue) {
    _ingestQueue = new Queue("ingest", { connection: getRedisConfig() });
  }
  return _ingestQueue;
}

export function getReindexQueue(): Queue {
  if (!_reindexQueue) {
    _reindexQueue = new Queue("reindex", { connection: getRedisConfig() });
  }
  return _reindexQueue;
}

export async function enqueueIngest(filepath: string): Promise<string> {
  const queue = getIngestQueue();
  const job = await queue.add("ingest-document", { filepath }, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
  return job.id ?? "unknown";
}

export async function enqueueReindex(): Promise<string> {
  const queue = getReindexQueue();
  const job = await queue.add("reindex-all", {}, {
    attempts: 1,
  });
  return job.id ?? "unknown";
}

export async function getQueueStats(): Promise<{ waiting: number; active: number }> {
  const queue = getIngestQueue();
  const [waiting, active] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
  ]);
  return { waiting, active };
}
