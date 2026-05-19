/**
 * Job queue — BullMQ on Redis.
 *
 * The MCP server enqueues ingestion jobs; the Python rag-worker
 * consumes them via its own BullMQ-compatible worker.
 * The TS side can also process simple text ingestion directly.
 */
import { Queue } from "bullmq";
import { getRedis } from "./redis.js";

let _ingestQueue: Queue | null = null;
let _reindexQueue: Queue | null = null;

export function getIngestQueue(): Queue {
  if (!_ingestQueue) {
    _ingestQueue = new Queue("ingest", { connection: getRedis("bullmq") });
  }
  return _ingestQueue;
}

export function getReindexQueue(): Queue {
  if (!_reindexQueue) {
    _reindexQueue = new Queue("reindex", { connection: getRedis("bullmq") });
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
