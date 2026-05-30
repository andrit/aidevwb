---
name: stream-vs-batch-decision
description: Choose between batch processing (scheduled runs over bounded datasets) and stream processing (continuous processing of unbounded event sequences) — decision guide, trade-offs, and how to add a streaming stage with Redis Streams
domain: data-pipeline
type: data-pipeline
triggers:
  - "stream vs batch"
  - "streaming pipeline"
  - "real-time pipeline"
  - "should I use streaming"
  - "Kafka Streams"
  - "continuous processing"
  - "Lambda architecture"
  - "Kappa architecture"
  - "event stream processing"
  - "add streaming"
---

# Stream vs Batch Decision

## When to use

When designing a new pipeline or when an existing batch pipeline's latency is no longer acceptable. Batch and streaming are not mutually exclusive — many production systems use both for different parts of the same data flow. Activate when the user asks "should this be batch or streaming?", "how do I make this real-time?", or "what's the difference between Kafka and a cron job?"

## The Core Distinction

```
Batch processing:
  - Runs on a bounded dataset (a snapshot of data at a point in time)
  - Triggered by a schedule (cron) or event (file arrival)
  - Latency = the cron interval + processing time (minutes to hours)
  - Failure: re-run from the start of the window

Stream processing:
  - Runs on an unbounded dataset (events arrive continuously, never ends)
  - Triggered by each event as it arrives
  - Latency = event-to-output time (milliseconds to seconds)
  - Failure: resume from last committed offset (no full re-run)
```

## Decision Guide

Answer these questions in order. Stop at the first "yes."

```
1. Can I tolerate minutes-to-hours of latency between source change and output?
   YES → Use batch. Simpler, easier to debug, easier to re-run.

2. Do I need to JOIN this data with another stream in a time window?
   (e.g., "match every click event with the impression that preceded it within 30 minutes")
   YES → Streaming is required. Batch joins on time windows are awkward.

3. Do I need to detect patterns across a sliding time window?
   (e.g., "alert if > 5 failed logins from the same IP within 10 minutes")
   YES → Streaming is required. Stateful windowed aggregations.

4. Is the data source unbounded (never-ending event log) AND latency matters?
   YES → Streaming.

5. Is this a one-time or infrequent transformation of historical data?
   YES → Batch. Streaming adds unnecessary complexity for finite datasets.

Default: batch. Streaming is more operationally complex. Only choose it when
         a batch alternative would be operationally unacceptable.
```

## Architecture Options

### Lambda Architecture (batch + streaming)

Run a batch layer for historical correctness and a streaming layer for low-latency approximate results. Merge them at query time.

```
Source events → Batch layer (hourly/daily) → Historical accurate results  ┐
             → Speed layer (streaming)    → Recent approximate results    ├→ Serving layer → Query
```

**When to use:** When you need both historical accuracy (backfill, reprocessing) and real-time results, and you can tolerate the operational burden of maintaining two pipelines.

**Downside:** Two codebases doing the same business logic. Bugs get fixed in one, not the other.

### Kappa Architecture (streaming only)

One pipeline, streaming. Historical reprocessing is done by replaying the event log from the beginning through the same streaming code.

```
Event log (Kafka / retained Redis Streams) → Streaming pipeline → Results
         ↑ replay for reprocessing
```

**When to use:** When the event log is retained long enough to replay from the beginning, and the streaming code can be run at replay speed for historical data.

**Workbench default:** Redis Streams with `MAXLEN` retention. Suitable for Kappa if retention window covers the historical data needed.

## Adding a Streaming Stage with Redis Streams

The workbench already has Redis Streams. For pipeline stages that need near-real-time processing:

```typescript
// src/services/stream-processor.ts
// Processes events from a Redis Stream continuously

const STREAM_KEY = "pipeline:user-events";
const CONSUMER_GROUP = "enrichment-processor";
const CONSUMER_NAME = `worker-${process.env.HOSTNAME ?? "local"}`;
const BATCH_SIZE = 100;
const BLOCK_MS = 2000;   // wait up to 2s for new messages

export async function startStreamProcessor(db: Db, redis: Redis): Promise<void> {
  // Create consumer group (idempotent)
  await redis.xgroup("CREATE", STREAM_KEY, CONSUMER_GROUP, "0", "MKSTREAM")
    .catch((err) => { if (!err.message.includes("BUSYGROUP")) throw err; });

  while (true) {
    const messages = await redis.xreadgroup(
      "GROUP", CONSUMER_GROUP, CONSUMER_NAME,
      "COUNT", BATCH_SIZE,
      "BLOCK", BLOCK_MS,
      "STREAMS", STREAM_KEY, ">"   // ">" = undelivered messages only
    );

    if (!messages) continue;  // timeout — no new messages

    for (const [, entries] of messages) {
      for (const [messageId, fields] of entries) {
        try {
          const event = JSON.parse(fields[1] as string);  // fields = [key, value, key, value...]
          await processUserEvent(db, event);

          // Acknowledge: remove from pending entries list
          await redis.xack(STREAM_KEY, CONSUMER_GROUP, messageId);
        } catch (err) {
          console.error({ messageId, err }, "stream processor: event failed");
          // Don't ACK — it stays in the pending list for retry or DLQ
        }
      }
    }
  }
}

// Claim messages that another consumer started but never acknowledged (crash recovery)
export async function claimStalePendingMessages(redis: Redis, maxIdleMs: number): Promise<void> {
  const pending = await redis.xautoclaim(
    STREAM_KEY, CONSUMER_GROUP, CONSUMER_NAME,
    maxIdleMs, "0-0", "COUNT", 100
  );
  // Process claimed messages the same way as new ones
}
```

## Windowed Aggregations (Streaming)

When you need "events in the last N minutes":

```typescript
// Count failed logins per IP in a 10-minute sliding window
// Store in Redis with TTL

async function recordLoginAttempt(
  redis: Redis,
  ip: string,
  success: boolean
): Promise<{ shouldBlock: boolean }> {
  if (success) return { shouldBlock: false };

  const key = `failed-logins:${ip}`;
  const windowSeconds = 10 * 60;
  const threshold = 5;

  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);  // set TTL on first failure

  return { shouldBlock: count >= threshold };
}
```

For more complex windowed joins (click + impression within 30 min), use Flink or Kafka Streams — Redis Streams alone doesn't support them natively.

## When Redis Streams Is Enough vs When You Need Kafka/Flink

| Feature | Redis Streams | Kafka | Flink / Kafka Streams |
|---------|--------------|-------|----------------------|
| Throughput | ~100k msg/s | ~1M+ msg/s | Depends on job |
| Retention | Configurable MAXLEN | Configurable days/bytes | N/A (reads from Kafka) |
| Consumer groups | ✓ | ✓ | ✓ |
| Exactly-once | With idempotent consumers | With transactions | ✓ |
| Windowed joins | ✗ Manual | ✗ Manual | ✓ Built-in |
| Stateful aggregations | ✗ Manual (Redis hash) | ✗ | ✓ Built-in |
| Schema registry | ✗ | Confluent Schema Registry | ✗ |
| Replay from beginning | Only if MAXLEN retains | Configurable retention | ✓ |

**Use Redis Streams when:**
- You're already using Redis in the workbench
- Throughput < 50k events/sec
- No complex windowed joins needed
- Retention window = days to weeks

**Use Kafka when:**
- Long-term retention (months) required for replay
- Multiple independent consumer groups with different offsets
- Very high throughput

**Use Flink/Kafka Streams when:**
- Windowed joins across multiple streams required
- Complex stateful aggregations (sessionization, funnels)

## Checklist

- [ ] Decision made and documented: batch or streaming, and why
- [ ] If streaming: latency requirement stated (what's acceptable: seconds? minutes?)
- [ ] If streaming: retention requirement stated (how far back must replay go?)
- [ ] If Redis Streams: consumer group created with `XGROUP CREATE ... MKSTREAM`
- [ ] Consumer acknowledges (`XACK`) only after successful processing
- [ ] Stale pending message claim job exists (for crash recovery)
- [ ] If complex windowed joins needed: Flink/Kafka Streams evaluated

## Files involved

| File | Action |
|------|--------|
| `src/services/stream-processor.ts` | Create: Redis Streams consumer loop |
| `src/index.ts` | Update: start stream processor alongside HTTP server |
| `docs/pipeline-architecture.md` | Create/update: document batch vs stream decision and rationale |

## Common mistakes

**Streaming as the default** — streaming is operationally harder: consumer groups, offset management, stale message reclaim, ordering guarantees, windowing. Start with batch. Migrate to streaming only when latency requirements force it.

**Not acknowledging after success** — if the consumer processes the event but crashes before `XACK`, the message stays in the pending list and is re-processed on restart. This is correct behavior (at-least-once). Your handlers must be idempotent.

**Building Lambda architecture when Kappa works** — maintaining two pipelines (batch + stream) doubles the operational burden and the risk of inconsistency. If your event log has sufficient retention for replay, use Kappa: one streaming pipeline that can replay from the beginning for historical reprocessing.
