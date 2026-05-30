---
name: setup-cdc-source
description: Use Change Data Capture to extract row-level inserts, updates, and deletes from a PostgreSQL replication log — lower latency than watermark polling, captures deletes, and zero load on the source at query time
domain: data-pipeline
type: data-pipeline
triggers:
  - "CDC"
  - "change data capture"
  - "replication log"
  - "capture deletes"
  - "real-time extraction"
  - "Debezium"
  - "logical replication"
  - "streaming from database"
  - "near real-time pipeline"
---

# Set Up a CDC Source

## When to use

When watermark polling (see `idempotency-and-incremental-loads`) is insufficient because:
- You need to capture **deletes** (watermarks can't see deleted rows)
- You need **sub-minute latency** between source write and pipeline processing
- The source table is so large that even watermark queries are expensive
- Multiple downstream consumers need the same change stream independently

CDC reads from PostgreSQL's Write-Ahead Log (WAL) — the replication log already written for durability — so it adds near-zero load to the source database.

## Prerequisites

- PostgreSQL with logical replication enabled (requires `wal_level = logical`)
- Source database accessible from the pipeline service
- `pg_logical` or built-in `pgoutput` plugin available (PostgreSQL 10+)

**Check if logical replication is enabled:**
```sql
SHOW wal_level;
-- Must return "logical". If "replica" or "minimal", it needs to be changed.
```

**Enable it (requires DB restart):**
```sql
-- postgresql.conf or via ALTER SYSTEM
ALTER SYSTEM SET wal_level = 'logical';
SELECT pg_reload_conf();  -- if already logical; otherwise requires restart
```

## Option A — Lightweight: `pg_logical` in Node.js

For smaller-scale workbench projects, connect directly to the PostgreSQL replication stream without an external broker.

### 1. Install the client library

```bash
npm install pg-logical-replication pg
```

### 2. Create a replication slot and publication

```sql
-- Run once on the source database
-- Publication: declares which tables to stream
CREATE PUBLICATION pipeline_source FOR TABLE users, orders, products;

-- Replication slot: tracks consumer's position in the WAL
-- Name must be unique; use snake_case, no dashes
SELECT pg_create_logical_replication_slot('pipeline_consumer', 'pgoutput');
```

### 3. Read the change stream

```typescript
// src/services/cdc-source.ts
import { LogicalReplicationService, PgoutputPlugin } from "pg-logical-replication";

interface CdcEvent {
  operation: "insert" | "update" | "delete";
  table: string;
  before: Record<string, unknown> | null;  // null for inserts
  after: Record<string, unknown> | null;   // null for deletes
  lsn: string;                              // log sequence number — position in WAL
}

export function startCdcStream(
  onEvent: (event: CdcEvent) => Promise<void>
): void {
  const service = new LogicalReplicationService({
    connectionString: process.env.SOURCE_DATABASE_URL,
  });

  const plugin = new PgoutputPlugin({
    protoVersion: 1,
    publicationNames: ["pipeline_source"],
  });

  service.on("data", async (lsn: string, log: any) => {
    for (const change of log.change ?? []) {
      await onEvent({
        operation: change.kind,         // "insert" | "update" | "delete"
        table: change.table,
        before: change.oldkeys ?? null,
        after: change.columnvalues
          ? Object.fromEntries(change.columnnames.map((k: string, i: number) => [k, change.columnvalues[i]]))
          : null,
        lsn,
      });
    }
    // Acknowledge the LSN — advances the replication slot
    await service.acknowledge(lsn);
  });

  service.subscribe(plugin, "pipeline_consumer").catch((err) => {
    console.error({ err }, "CDC stream error");
    process.exit(1);  // let Docker restart
  });
}
```

### 4. Route events to pipeline stages

```typescript
// src/services/pipeline.ts
import { startCdcStream } from "./cdc-source";

startCdcStream(async (event) => {
  if (event.table === "users") {
    switch (event.operation) {
      case "insert":
      case "update":
        await processUserChange(db, event.after!);
        break;
      case "delete":
        await handleUserDeleted(db, event.before!.id as string);
        break;
    }
  }

  if (event.table === "orders" && event.operation === "insert") {
    await processNewOrder(db, event.after!);
  }
});
```

## Option B — Production Scale: Debezium + Kafka/Redis Streams

For higher throughput, multiple consumers, or when you want the change stream available to more than one service.

```yaml
# docker-compose.yml addition — Debezium connector
  debezium:
    image: debezium/connect:2.4
    environment:
      BOOTSTRAP_SERVERS: kafka:9092    # or use Redis Streams via a custom connector
      GROUP_ID: 1
      CONFIG_STORAGE_TOPIC: debezium_configs
      OFFSET_STORAGE_TOPIC: debezium_offsets
    ports:
      - "8083:8083"
```

```bash
# Register the PostgreSQL connector via Debezium's REST API
curl -X POST http://localhost:8083/connectors \
  -H "Content-Type: application/json" \
  -d '{
    "name": "source-connector",
    "config": {
      "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
      "database.hostname": "postgres",
      "database.port": "5432",
      "database.user": "replication_user",
      "database.password": "...",
      "database.dbname": "source_db",
      "database.server.name": "source",
      "table.include.list": "public.users,public.orders",
      "plugin.name": "pgoutput",
      "publication.name": "pipeline_source",
      "slot.name": "debezium_slot"
    }
  }'
```

For the workbench, Option A (direct pg_logical) is recommended unless you already have Kafka in the stack.

## Step 5 — Handle Deletes

CDC's main advantage over watermarks: you can see deletions.

```typescript
async function handleUserDeleted(db: Db, userId: string): Promise<void> {
  // Soft-delete in the destination (preserves history)
  await db.none(
    "UPDATE enriched_users SET deleted_at=NOW(), last_updated_at=NOW() WHERE user_id=$1",
    [userId]
  );

  // Or hard-delete if the destination doesn't need history
  await db.none("DELETE FROM enriched_users WHERE user_id=$1", [userId]);
}
```

## Step 6 — Resume After Restart

The replication slot tracks your position in the WAL (Log Sequence Number). If the consumer restarts, it resumes from where it left off — no events are missed, no duplicates (at the stream level; your processing must still be idempotent).

```typescript
// The slot is persistent — as long as you use the same slot name,
// PostgreSQL holds the WAL until you've acknowledged it.
// Downside: if the consumer is offline for too long, the WAL can grow large.
// Set a maximum retention:
ALTER SUBSCRIPTION pipeline_consumer SET (wal_receiver_timeout = '30s');

-- Monitor WAL accumulation:
SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as lag
FROM pg_replication_slots;
```

```typescript
// In the consumer: acknowledge frequently to release WAL space
// Don't batch too many events before acknowledging
const MAX_UNACKNOWLEDGED = 1000;
let unacknowledged = 0;

service.on("data", async (lsn, log) => {
  await processEvent(log);
  unacknowledged++;
  if (unacknowledged >= MAX_UNACKNOWLEDGED) {
    await service.acknowledge(lsn);
    unacknowledged = 0;
  }
});
```

## Watermark vs CDC Decision

| Factor | Watermark polling | CDC |
|--------|------------------|-----|
| Latency | Minutes (cron interval) | Milliseconds |
| Captures deletes | ✗ No | ✓ Yes |
| Source DB load | Query on every run | Near-zero (reads WAL) |
| Complexity | Low | Medium |
| Works with any DB | ✓ Yes | PostgreSQL 10+ / MySQL / MongoDB |
| Handles schema changes | ✓ Yes | Needs Debezium schema registry for complex changes |
| Good for large tables | With indexes | Yes |

**Use watermarks when:**
- Cron-schedule latency (hourly, daily) is acceptable
- Source doesn't delete records
- Simple setup is preferred

**Use CDC when:**
- Near-real-time processing required
- Deletes must be captured
- Source table is queried by many other workloads (CDC avoids adding another query)

## Checklist

- [ ] `wal_level = logical` confirmed on source PostgreSQL
- [ ] Publication created (`CREATE PUBLICATION`) for required tables
- [ ] Replication slot created (`pg_create_logical_replication_slot`)
- [ ] Consumer acknowledges LSN promptly (no unbounded WAL accumulation)
- [ ] WAL accumulation monitored: `pg_replication_slots` size alerting set up
- [ ] Delete events handled: soft-delete or hard-delete in destination
- [ ] Consumer is idempotent: same WAL event processed twice produces same result
- [ ] Consumer restarts cleanly from the slot's position (no manual reset needed)
- [ ] Tested: insert, update, and delete in source → verify all appear in destination

## Files involved

| File | Action |
|------|--------|
| `src/services/cdc-source.ts` | Create: `startCdcStream`, LSN acknowledgment |
| `src/services/pipeline.ts` | Update: route CDC events to stage handlers |
| `src/services/load.ts` | Update: add `handleDeleted` function |
| `docker-compose.yml` | Update (optional): add Debezium if needed |

## Common mistakes

**Not acknowledging LSN** — if your consumer reads events but never calls `acknowledge(lsn)`, PostgreSQL holds the entire WAL since the slot was created. On a busy source DB, this fills the disk. Always acknowledge promptly; always monitor `pg_replication_slots`.

**Treating CDC as exactly-once** — replication slots guarantee at-least-once delivery. If the consumer crashes after processing but before acknowledging, it re-receives the same events. Your processing (upserts, idempotency keys) must tolerate duplicates.

**Using CDC for bulk historical backfill** — CDC reads from the current WAL position, not from the beginning of time. For initial load of historical data, use a watermark-based batch extract, then switch to CDC for ongoing changes.
