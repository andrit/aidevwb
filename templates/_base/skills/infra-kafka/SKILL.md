---
name: infra-kafka
description: Add Kafka for high-throughput event streaming — producer/consumer patterns, topic design, consumer groups, exactly-once semantics, and guidance on when to use Kafka vs the workbench Redis bus
domain: infrastructure
type: cross-cutting
triggers:
  - "kafka"
  - "event streaming"
  - "producer consumer"
  - "message queue"
  - "exactly once"
  - "high throughput events"
  - "event-driven architecture"
  - "Kafka topic"
  - "consumer group"
---

# Kafka Event Streaming

## When to use

Reach for Kafka when the workbench Redis bus is not sufficient. The decision boundary:

| Need | Use |
|------|-----|
| Internal workbench events, SSE to browser, simple pub/sub across containers | **Redis bus** (built-in, zero config) |
| Replay events from an arbitrary past offset | **Kafka** — Redis streams have limited retention |
| Fan-out to many independent consumer groups that each maintain their own cursor | **Kafka** — Redis consumer groups work but operational complexity grows fast |
| > ~10,000 events/second sustained | **Kafka** — Redis Streams are fast but Kafka partitions scale horizontally |
| Exactly-once delivery guarantee end-to-end | **Kafka** with idempotent producer + transactional consumer |
| Events need to outlive the Redis container (permanent audit log) | **Kafka** with topic retention policy |
| Cross-service event backbone shared with non-workbench systems | **Kafka** — neutral protocol, many language clients |

Kafka adds operational weight. Do not use it when the Redis bus suffices.

## Prerequisites

- Docker and `docker compose` running
- Node.js project in place (workbench mcp-server or a scaffold project)
- `kafkajs` package available: `npm install kafkajs`
- At least 2 GB RAM available on the host (Kafka + ZooKeeper or KRaft)

## Step 1 — Add Kafka to docker-compose.yml

This uses KRaft mode (no ZooKeeper, Kafka 3.7+) for simplicity.

```yaml
# ═══════════════════════════════════════════════════════════
#  KAFKA — High-throughput event streaming (KRaft mode)
# ═══════════════════════════════════════════════════════════
kafka:
  image: apache/kafka:3.7.0
  container_name: kafka
  ports:
    - "9092:9092"       # client access from host
    - "9093:9093"       # internal broker-to-broker (KRaft controller)
  environment:
    # KRaft: combined broker + controller role
    KAFKA_NODE_ID: 1
    KAFKA_PROCESS_ROLES: broker,controller
    KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
    KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
    KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
    KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT
    KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
    KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
    KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
    KAFKA_LOG_DIRS: /var/lib/kafka/data
    KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"   # explicit topic creation only
    KAFKA_LOG_RETENTION_HOURS: 168             # 7-day retention
    KAFKA_LOG_RETENTION_BYTES: -1              # no byte limit (rely on time)
    CLUSTER_ID: "MkU3OEVBNTcwNTJENDM2Qk"      # base64 UUID, generate once
  volumes:
    - kafka-data:/var/lib/kafka/data
  networks:
    - workbench
  healthcheck:
    test: ["CMD-SHELL", "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 > /dev/null 2>&1"]
    interval: 15s
    timeout: 10s
    retries: 5
    start_period: 30s

kafka-init:
  image: apache/kafka:3.7.0
  container_name: kafka-init
  depends_on:
    kafka:
      condition: service_healthy
  networks:
    - workbench
  entrypoint: ["/bin/bash", "-c"]
  # Create topics on first boot. Idempotent — safe to re-run.
  command: |
    "
    /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 \
      --create --if-not-exists \
      --topic workbench.events \
      --partitions 4 \
      --replication-factor 1 \
      --config retention.ms=604800000

    /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 \
      --create --if-not-exists \
      --topic workbench.rag.ingest \
      --partitions 2 \
      --replication-factor 1 \
      --config retention.ms=86400000

    /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 \
      --create --if-not-exists \
      --topic workbench.agent.tasks \
      --partitions 4 \
      --replication-factor 1 \
      --config retention.ms=604800000

    echo 'Topics created.'
    "
  restart: "no"
```

Add the volume at the bottom of `docker-compose.yml`:

```yaml
volumes:
  kafka-data:
```

## Step 2 — Topic naming convention

```
workbench.<service>.<event-type>

Examples:
  workbench.events           — general workbench lifecycle events
  workbench.rag.ingest       — document ingest requests
  workbench.rag.chunk        — individual chunk processing results
  workbench.agent.tasks      — agent task dispatch
  workbench.agent.results    — agent task completion
  workbench.<project>.custom — project-specific events
```

Rules:
- Lowercase, dot-separated
- `workbench.` prefix for all workbench-owned topics
- Partitions: 4 for high-volume, 2 for low-volume; never 1 (no parallelism)
- Replication factor: 1 for single-node dev; 3 for multi-broker production

## Step 3 — Producer (Node.js / kafkajs)

```typescript
// src/lib/kafka.ts
import { Kafka, Producer, CompressionTypes, logLevel } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'mcp-server',
  brokers: [(process.env.KAFKA_BROKERS ?? 'kafka:9092')],
  logLevel: logLevel.WARN,
});

let producer: Producer | null = null;

export async function getProducer(): Promise<Producer> {
  if (!producer) {
    producer = kafka.producer({
      idempotent: true,                        // exactly-once at the producer level
      maxInFlightRequests: 5,                  // required when idempotent=true
      transactionTimeout: 30_000,
    });
    await producer.connect();
  }
  return producer;
}

export async function publish(
  topic: string,
  key: string,
  value: unknown,
  headers?: Record<string, string>
): Promise<void> {
  const p = await getProducer();
  await p.send({
    topic,
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key,
        value: JSON.stringify(value),
        headers: {
          'content-type': 'application/json',
          'source-service': 'mcp-server',
          ...headers,
        },
      },
    ],
  });
}

// Call at process shutdown
export async function disconnectProducer(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
}
```

Usage in a service:

```typescript
import { publish } from '../lib/kafka.js';

// After a RAG ingest completes:
await publish(
  'workbench.rag.ingest',
  documentId,                // partition key — same doc always hits same partition
  { documentId, projectName, chunkCount, durationMs },
);
```

## Step 4 — Consumer group (Node.js / kafkajs)

```typescript
// src/workers/rag-event-consumer.ts
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'rag-consumer',
  brokers: [(process.env.KAFKA_BROKERS ?? 'kafka:9092')],
});

export async function startRagConsumer(): Promise<void> {
  const consumer: Consumer = kafka.consumer({
    groupId: 'workbench-rag-processors',   // all instances with same groupId share partitions
    sessionTimeout: 30_000,
    heartbeatInterval: 3_000,
  });

  await consumer.connect();
  await consumer.subscribe({ topic: 'workbench.rag.ingest', fromBeginning: false });

  await consumer.run({
    // Process one message at a time per partition; set to >1 for throughput
    eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      if (!message.value) return;

      let payload: unknown;
      try {
        payload = JSON.parse(message.value.toString());
      } catch {
        console.error(`[kafka] Malformed message on ${topic}/${partition}:`, message.value.toString());
        return; // skip — do not throw or the consumer will retry indefinitely
      }

      console.log(`[kafka] Processing ${topic} offset=${message.offset}`, payload);
      await processRagEvent(payload as RagIngestEvent);
    },
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await consumer.disconnect();
  });
}

interface RagIngestEvent {
  documentId: string;
  projectName: string;
  chunkCount: number;
  durationMs: number;
}

async function processRagEvent(event: RagIngestEvent): Promise<void> {
  // downstream processing — e.g., update search index, trigger eval, etc.
  console.log(`[rag-consumer] Processed doc=${event.documentId} chunks=${event.chunkCount}`);
}
```

## Step 5 — Exactly-once with transactions

Use transactions when a consumer reads from one topic and writes to another and you cannot tolerate duplicates (e.g., billing, audit).

```typescript
// Transactional producer — one per application instance
const txProducer = kafka.producer({
  idempotent: true,
  transactionalId: `mcp-server-tx-${process.env.HOSTNAME ?? 'local'}`,
  maxInFlightRequests: 5,
});
await txProducer.connect();

// Inside consumer.run eachBatch:
const transaction = await txProducer.transaction();
try {
  await transaction.send({ topic: 'workbench.agent.results', messages: [/* ... */] });
  await transaction.sendOffsets({
    consumerGroupId: 'workbench-rag-processors',
    topics: [{ topic: 'workbench.rag.ingest', partitions: [{ partition, offset: (Number(offset) + 1).toString() }] }],
  });
  await transaction.commit();
} catch (err) {
  await transaction.abort();
  throw err;
}
```

## Step 6 — Verify

```bash
# List topics
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 --list

# Produce a test message
docker compose exec kafka /opt/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server localhost:9092 --topic workbench.events
# Type: {"type":"test","ts":1234567890}  then Ctrl+C

# Consume from beginning
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 --topic workbench.events \
  --from-beginning --max-messages 5

# Consumer group lag
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 --describe --group workbench-rag-processors
```

## Checklist

- [ ] Kafka service added to `docker-compose.yml` with KRaft (no ZooKeeper)
- [ ] `CLUSTER_ID` is a unique base64 UUID (generate with `uuidgen | base64 | cut -c1-22`)
- [ ] Topics created via `kafka-init` service (not auto-create)
- [ ] Topic naming follows `workbench.<service>.<event-type>` convention
- [ ] Producer is idempotent (`idempotent: true`)
- [ ] Consumer group ID is stable and descriptive
- [ ] Malformed messages caught and skipped (no infinite retry loop)
- [ ] Graceful shutdown: `producer.disconnect()` and `consumer.disconnect()` on SIGTERM
- [ ] Consumer lag monitored: `kafka-consumer-groups.sh --describe`

## Files involved

| File | Action |
|------|--------|
| `docker-compose.yml` | Add `kafka`, `kafka-init` services; add `kafka-data` volume |
| `apps/mcp-server/src/lib/kafka.ts` | Create: singleton producer, `publish()` helper |
| `apps/mcp-server/src/workers/rag-event-consumer.ts` | Create: consumer group for RAG events |
| `.env.example` | Add `KAFKA_BROKERS=kafka:9092` |

## Common mistakes

**Using `auto.create.topics.enable=true` in production** — topics get created with default settings (1 partition, 1 replica) the first time any producer or consumer references them. This silently bypasses your naming convention and partition strategy. Always disable auto-creation and manage topics explicitly with `kafka-topics.sh` or `kafka-init`.

**One partition per topic** — a topic with one partition can only be consumed by one consumer instance in a group at a time, eliminating horizontal scaling. Use at least 2; use 4 for anything expected to grow.

**Not setting `idempotent: true` on the producer** — without idempotency, network retries can duplicate messages. The cost of idempotency is negligible; always enable it.

**Catching errors and swallowing them in `eachMessage`** — if your handler throws, kafkajs will retry the message from the same offset. If it never throws (you catch everything), bad messages are silently dropped. Log explicitly and decide: dead-letter topic or skip. Never swallow without logging.

**Using the same `transactionalId` across multiple running instances** — `transactionalId` must be unique per producer instance. Use `hostname` or pod name as a suffix. Sharing it across instances causes one producer to "fence" the other, triggering errors.
