---
name: implement-outbox-pattern
description: Solve the dual-write problem — write a domain event to a DB outbox table inside the same transaction as the state change, then relay it to the message bus reliably without losing events or producing duplicates
domain: microservices
type: microservices
triggers:
  - "outbox pattern"
  - "transactional outbox"
  - "dual write"
  - "event not published"
  - "event lost"
  - "publish after transaction"
  - "reliable event publishing"
  - "at-least-once events"
---

# Implement the Outbox Pattern

## When to use

Whenever a service writes state to a database AND needs to publish a domain event. The naive approach — write to DB, then publish to the bus — has a gap: if the process crashes between the two, the DB write commits but the event is never published. Consumers never hear about the state change. The outbox pattern closes that gap. Activate when a service emits events, or when you've seen "event not published" bugs after deploys.

## Prerequisites

- Service with a PostgreSQL database (one per bounded context)
- Redis Streams message bus (`bus_publish` MCP tool or direct API call)
- At least one service method that should emit a domain event after a state change

## The Problem

```
WITHOUT outbox — the dual-write gap:
  1. BEGIN TRANSACTION
  2. UPDATE orders SET status='placed' WHERE id=$1   ← succeeds
  3. COMMIT                                           ← succeeds
  4. publish("orders.placed", payload)               ← process crashes HERE
     → DB has the new state
     → Bus has no event
     → Fulfillment never starts. Order sits forever.

WITH outbox — atomic write:
  1. BEGIN TRANSACTION
  2. UPDATE orders SET status='placed' WHERE id=$1
  3. INSERT INTO outbox (event_type, payload) VALUES (...)  ← same transaction
  4. COMMIT                                                  ← both or neither
  5. Relay process reads outbox and publishes               ← retried if it crashes
```

## Step 1 — Create the Outbox Table

```sql
-- supabase/migrations/011_outbox.sql
CREATE TABLE outbox (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  channel     TEXT NOT NULL,           -- the Redis Streams channel to publish to
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ,            -- NULL = not yet published
  attempts    INT DEFAULT 0
);

-- Index for the relay query: unpublished events in order
CREATE INDEX ON outbox (created_at) WHERE published_at IS NULL;
```

## Step 2 — Write to the Outbox Inside the Transaction

```typescript
// src/services/orders.ts
import type { Db } from "./db";
import { OrderPlacedEvent } from "../schemas/events";

export async function placeOrder(db: Db, orderId: string): Promise<Order> {
  return db.tx(async (t) => {
    // 1. Load + validate
    const order = await getOrder(t, orderId);
    if (order.lineItems.length === 0) throw new DomainError("Order must have items");

    // 2. Apply state change
    await t.none(
      "UPDATE orders SET status='placed', placed_at=NOW() WHERE id=$1",
      [orderId]
    );

    // 3. Write event to outbox — INSIDE the same transaction
    const event: OrderPlaced = {
      eventId: crypto.randomUUID(),
      eventType: "OrderPlaced",
      aggregateId: orderId,
      occurredAt: new Date(),
      version: 1,
      payload: buildOrderPlacedPayload(order),
    };

    await t.none(
      `INSERT INTO outbox (event_type, payload, channel)
       VALUES ($1, $2, $3)`,
      ["OrderPlaced", JSON.stringify(event), "orders.placed"]
    );

    return getOrder(t, orderId);
  });
  // Transaction commits: both the state change and the outbox entry land atomically.
  // If the process crashes here, the outbox entry exists and the relay will publish it later.
}
```

## Step 3 — Build the Relay Process

The relay polls the outbox for unpublished entries and forwards them to the message bus. It runs as a separate background task (not in the request path).

```typescript
// src/services/outbox-relay.ts
import type { Db } from "./db";

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 1000;
const MAX_ATTEMPTS = 5;

export async function startOutboxRelay(db: Db): Promise<void> {
  // Run forever; restart on crash (managed by Docker restart policy or pm2)
  while (true) {
    try {
      await relayBatch(db);
    } catch (err) {
      console.error({ err }, "outbox relay: batch failed");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function relayBatch(db: Db): Promise<void> {
  // Use SELECT FOR UPDATE SKIP LOCKED — safe for multiple relay instances
  const entries = await db.any<OutboxEntry>(
    `SELECT id, event_type, payload, channel
     FROM outbox
     WHERE published_at IS NULL AND attempts < $1
     ORDER BY created_at
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [MAX_ATTEMPTS, BATCH_SIZE]
  );

  if (entries.length === 0) return;

  for (const entry of entries) {
    try {
      // Publish to the message bus
      await fetch(`${process.env.MCP_SERVER_URL}/bus/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: entry.channel,
          message: entry.payload,
        }),
      });

      // Mark as published
      await db.none(
        "UPDATE outbox SET published_at=NOW(), attempts=attempts+1 WHERE id=$1",
        [entry.id]
      );
    } catch (err) {
      // Increment attempts — after MAX_ATTEMPTS, this entry is skipped and needs manual review
      await db.none(
        "UPDATE outbox SET attempts=attempts+1 WHERE id=$1",
        [entry.id]
      );
      console.error({ entry: entry.id, err }, "outbox relay: publish failed");
    }
  }
}
```

## Step 4 — Start the Relay Alongside the Server

```typescript
// src/index.ts
import { startOutboxRelay } from "./services/outbox-relay";

const app = buildApp();

app.listen({ port: config.port }, async (err) => {
  if (err) { app.log.error(err); process.exit(1); }

  // Start the relay in the background
  // It runs independently of HTTP requests
  startOutboxRelay(db).catch((err) => {
    app.log.error(err, "outbox relay crashed");
    process.exit(1); // let Docker restart the process
  });
});
```

## Step 5 — Purge Old Published Entries

The outbox table grows indefinitely if not cleaned up. Add a periodic purge:

```sql
-- Run as a scheduled job (pg_cron, or a Make target called from cron)
DELETE FROM outbox
WHERE published_at IS NOT NULL
  AND published_at < NOW() - INTERVAL '7 days';
```

Or in the relay process:
```typescript
// Once per hour, purge entries published more than 7 days ago
if (Date.now() % (60 * 60 * 1000) < POLL_INTERVAL_MS) {
  await db.none(
    "DELETE FROM outbox WHERE published_at IS NOT NULL AND published_at < NOW() - INTERVAL '7 days'"
  );
}
```

## Step 6 — Monitor for Stuck Entries

```sql
-- Entries that have failed MAX_ATTEMPTS times — need manual review
SELECT id, event_type, channel, attempts, created_at, payload
FROM outbox
WHERE published_at IS NULL AND attempts >= 5
ORDER BY created_at;

-- Lag: how far behind is the relay?
SELECT COUNT(*) as unpublished,
       MIN(created_at) as oldest_unpublished,
       EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) as lag_seconds
FROM outbox
WHERE published_at IS NULL AND attempts < 5;
```

## Checklist

- [ ] `outbox` table created with `published_at` and `attempts` columns
- [ ] Every service method that emits an event writes to `outbox` inside `db.tx()`
- [ ] No `bus_publish` / `fetch('/bus/publish')` calls inside transactions or service functions — only the relay publishes
- [ ] Relay uses `SELECT FOR UPDATE SKIP LOCKED` (safe for horizontal scaling)
- [ ] Relay increments `attempts` on failure; stops retrying after `MAX_ATTEMPTS`
- [ ] Relay started alongside the HTTP server in `src/index.ts`
- [ ] Docker service has `restart: unless-stopped` so relay restarts on crash
- [ ] Purge job configured for entries older than 7 days
- [ ] Alert / monitoring query exists for stuck entries (`attempts >= MAX_ATTEMPTS`)
- [ ] Consumers are idempotent on `eventId` — the relay guarantees at-least-once, not exactly-once

## Files involved

| File | Action |
|------|--------|
| `supabase/migrations/011_outbox.sql` | Create: `outbox` table |
| `src/services/outbox-relay.ts` | Create: relay loop, `relayBatch`, `startOutboxRelay` |
| `src/services/<domain>.ts` | Update: replace `bus_publish` calls with outbox inserts inside `db.tx()` |
| `src/index.ts` | Update: call `startOutboxRelay(db)` after server starts |

## Common mistakes

**Publishing inside the transaction** — `await busPublish(...)` inside `db.tx()` holds the DB transaction open while waiting for a network call. If the bus call is slow or times out, the transaction is held open (locks held, connection pool depleted). The outbox write is a fast local DB insert; the slow network call happens outside the transaction in the relay.

**Not using `SKIP LOCKED`** — without it, two relay instances reading the outbox at the same time will block each other on the same rows. `SKIP LOCKED` lets each instance claim different rows concurrently, enabling horizontal scaling.

**Treating outbox as permanent storage** — the outbox is a delivery buffer, not an event log. Once published, entries should be deleted. A large unpurged outbox slows every relay query.

**Assuming exactly-once delivery** — the relay guarantees at-least-once. If the relay publishes successfully but crashes before marking `published_at`, the entry is retried and the event is published twice. Consumers must be idempotent on `eventId`.
