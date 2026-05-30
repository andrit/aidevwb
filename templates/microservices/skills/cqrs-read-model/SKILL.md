---
name: cqrs-read-model
description: Separate the write model (normalized aggregates, enforces invariants) from the read model (denormalized projections, optimized for queries) — build and maintain a read model by consuming domain events
domain: microservices
type: microservices
triggers:
  - "CQRS"
  - "read model"
  - "query model"
  - "projection"
  - "read side"
  - "write side"
  - "separate read and write"
  - "denormalized view"
  - "event projection"
  - "slow queries"
  - "query is too complex"
---

# CQRS Read Model

## When to use

When query performance suffers because the normalized write model requires too many joins, or when the shape of data needed for reads is very different from the shape used for writes. CQRS (Command Query Responsibility Segregation) maintains two separate models: the write model enforces invariants, the read model is optimized for how data is actually queried. Activate when services have complex multi-table queries, slow dashboard loads, or need to serve multiple consumers with different data shapes.

## Prerequisites

- Service with domain events flowing through the outbox or message bus (see `implement-outbox-pattern`)
- Identified query that is slow or complex to serve from the normalized write model
- Bounded context defined — CQRS is applied per-context, not system-wide

## What Changes

```
BEFORE CQRS — every query hits the normalized write model:
  GET /orders/:id/summary
    → JOIN orders, order_line_items, products, customers, fulfillment_status
    → 5 tables, complex query, slow under load

AFTER CQRS — reads come from a pre-built projection:
  Write side:  orders, order_line_items  (unchanged, enforces invariants)
  Read side:   order_summaries           (denormalized, updated by event consumer)
  GET /orders/:id/summary → SELECT * FROM order_summaries WHERE order_id=$1
```

The read model is a derived, throwaway table. It can be rebuilt at any time by replaying events from the beginning.

## Step 1 — Design the Read Model Schema

Start from the query, not the write model. What does the API response actually look like?

```typescript
// The query we want to serve efficiently:
// GET /orders/:id/summary → everything the UI needs in one row

// Read model: one row per order, denormalized
const OrderSummarySchema = z.object({
  orderId: z.string().uuid(),
  orderNumber: z.string(),           // human-readable: "ORD-001234"
  status: z.string(),
  customerName: z.string(),          // denormalized from Identity context
  customerEmail: z.string(),
  itemCount: z.number().int(),
  lineItems: z.array(z.object({      // JSONB — avoid joins at query time
    productName: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
  })),
  subtotal: z.number(),
  total: z.number(),
  shippingAddress: z.string(),       // formatted string — pre-rendered
  placedAt: z.coerce.date().nullable(),
  shippedAt: z.coerce.date().nullable(),
  estimatedDelivery: z.coerce.date().nullable(),
  lastUpdatedAt: z.coerce.date(),
});
```

```sql
-- supabase/migrations/012_order_summaries_read_model.sql
CREATE TABLE order_summaries (
  order_id          UUID PRIMARY KEY,
  order_number      TEXT NOT NULL,
  status            TEXT NOT NULL,
  customer_name     TEXT NOT NULL,
  customer_email    TEXT NOT NULL,
  item_count        INT NOT NULL,
  line_items        JSONB NOT NULL DEFAULT '[]',
  subtotal          NUMERIC(12,2) NOT NULL,
  total             NUMERIC(12,2) NOT NULL,
  shipping_address  TEXT NOT NULL,
  placed_at         TIMESTAMPTZ,
  shipped_at        TIMESTAMPTZ,
  estimated_delivery TIMESTAMPTZ,
  last_updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for the query patterns you actually have
CREATE INDEX ON order_summaries(status);
CREATE INDEX ON order_summaries(customer_email);
CREATE INDEX ON order_summaries(placed_at DESC);
```

## Step 2 — Build the Projection (Event Consumer)

The projection listens to domain events and updates the read model accordingly.

```typescript
// src/projections/order-summary.ts

export async function handleOrderPlaced(db: Db, event: OrderPlaced): Promise<void> {
  const { orderId, customerId, lineItems, total, shippingAddress, occurredAt } = event.payload;

  // Fetch customer name/email — cross-context data needed for the read model
  // In practice: either from a local cache or a synchronous call at projection time
  const customer = await fetchCustomerDetails(customerId);

  const subtotal = lineItems.reduce((sum, li) => sum + li.unitPrice.amount * li.quantity, 0);

  await db.none(
    `INSERT INTO order_summaries (
       order_id, order_number, status, customer_name, customer_email,
       item_count, line_items, subtotal, total, shipping_address, placed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (order_id) DO UPDATE SET
       status = EXCLUDED.status,
       placed_at = EXCLUDED.placed_at,
       last_updated_at = NOW()`,
    [
      orderId,
      generateOrderNumber(orderId),
      "placed",
      customer.name,
      customer.email,
      lineItems.length,
      JSON.stringify(lineItems.map((li) => ({
        productName: li.productName,
        quantity: li.quantity,
        unitPrice: li.unitPrice.amount,
      }))),
      subtotal,
      total.amount,
      formatAddress(shippingAddress),
      occurredAt,
    ]
  );
}

export async function handleOrderShipped(db: Db, event: OrderShipped): Promise<void> {
  await db.none(
    `UPDATE order_summaries
     SET status='shipped', shipped_at=$2, estimated_delivery=$3, last_updated_at=NOW()
     WHERE order_id=$1`,
    [event.payload.orderId, event.payload.shippedAt, event.payload.estimatedDelivery]
  );
}

export async function handleOrderCancelled(db: Db, event: OrderCancelled): Promise<void> {
  await db.none(
    "UPDATE order_summaries SET status='cancelled', last_updated_at=NOW() WHERE order_id=$1",
    [event.payload.orderId]
  );
}
```

## Step 3 — Wire the Projection to the Event Consumer

```typescript
// src/services/event-consumer.ts
import * as OrderSummaryProjection from "../projections/order-summary";

const EVENT_HANDLERS: Record<string, (db: Db, event: any) => Promise<void>> = {
  OrderPlaced:    OrderSummaryProjection.handleOrderPlaced,
  OrderShipped:   OrderSummaryProjection.handleOrderShipped,
  OrderCancelled: OrderSummaryProjection.handleOrderCancelled,
};

export async function startEventConsumer(db: Db): Promise<void> {
  while (true) {
    try {
      const messages = await readFromBus("orders.*");  // subscribe to all order events

      for (const msg of messages) {
        const handler = EVENT_HANDLERS[msg.eventType];
        if (!handler) continue;  // unknown event — safe to skip

        // Idempotency: skip if already processed
        const alreadyProcessed = await db.oneOrNone(
          "SELECT 1 FROM processed_projection_events WHERE event_id=$1",
          [msg.eventId]
        );
        if (alreadyProcessed) continue;

        await handler(db, msg);

        await db.none(
          "INSERT INTO processed_projection_events (event_id, processed_at) VALUES ($1, NOW())",
          [msg.eventId]
        );
      }
    } catch (err) {
      console.error({ err }, "event consumer error");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
```

## Step 4 — Add the Read API Route

```typescript
// src/routes/order-queries.ts — the "query side" routes
// Kept separate from the write-side routes in src/routes/orders.ts

export async function registerOrderQueryRoutes(app: FastifyInstance): Promise<void> {
  // Read from the read model — no joins, no aggregation at query time
  app.get("/orders/:orderId/summary", async (req, reply) => {
    const summary = await req.db.oneOrNone(
      "SELECT * FROM order_summaries WHERE order_id=$1",
      [req.params.orderId]
    );
    if (!summary) return reply.code(404).send({ error: "Order not found" });
    return OrderSummarySchema.parse(camelCaseKeys(summary));
  });

  // Complex queries become simple with the read model
  app.get("/customers/:customerId/orders", async (req, reply) => {
    return req.db.any(
      `SELECT * FROM order_summaries
       WHERE customer_email = (SELECT email FROM customers WHERE id=$1)
       ORDER BY placed_at DESC LIMIT 20`,
      [req.params.customerId]
    );
  });
}
```

## Step 5 — Rebuild the Read Model From Scratch

Because the read model is derived, it can always be rebuilt by replaying all events. This is how you handle bugs in projection logic or schema migrations.

```typescript
// src/scripts/rebuild-read-model.ts
// Run as a one-off: npx tsx src/scripts/rebuild-read-model.ts

async function rebuildOrderSummaries(db: Db): Promise<void> {
  console.log("Truncating read model...");
  await db.none("TRUNCATE order_summaries");
  await db.none("DELETE FROM processed_projection_events WHERE event_id LIKE 'rebuild-%'");

  // Replay all historical events from oldest to newest
  // In the workbench: query the outbox (if retained) or a separate event log
  const allEvents = await db.any(
    "SELECT payload FROM event_log ORDER BY occurred_at ASC"
  );

  console.log(`Replaying ${allEvents.length} events...`);
  for (const { payload } of allEvents) {
    const event = JSON.parse(payload);
    const handler = EVENT_HANDLERS[event.eventType];
    if (handler) await handler(db, event);
  }

  console.log("Read model rebuilt.");
}
```

## Checklist

- [ ] Read model schema designed from the query shape, not the write model
- [ ] Read model table created with indexes matching query patterns
- [ ] Projection handlers: one function per event type, upsert into read model
- [ ] Projection consumer checks idempotency on `eventId` before processing
- [ ] Read API routes separate from write routes (`order-queries.ts` vs `orders.ts`)
- [ ] Read routes query only the read model — no joins to the write model tables
- [ ] `rebuild-read-model.ts` script exists and tested
- [ ] Event consumer started alongside the HTTP server in `src/index.ts`
- [ ] Stale read model acceptable? Document the expected lag (typically < 1 second with Redis Streams)

## Files involved

| File | Action |
|------|--------|
| `supabase/migrations/012_*_read_model.sql` | Create: read model table + indexes |
| `supabase/migrations/013_processed_projection_events.sql` | Create: idempotency tracking |
| `src/schemas/<domain>-queries.ts` | Create: Zod schemas for read model shapes |
| `src/projections/<domain>.ts` | Create: projection handler functions |
| `src/services/event-consumer.ts` | Create: event loop + handler dispatch |
| `src/routes/<domain>-queries.ts` | Create: read-side API routes |
| `src/index.ts` | Update: start event consumer |
| `src/scripts/rebuild-read-model.ts` | Create: full replay script |

## Common mistakes

**Reading from the write model in read routes** — defeats the purpose. If the read route joins `orders` with `order_line_items` and `customers`, you haven't applied CQRS, you've just renamed some files. Read routes must only query the read model table.

**Rebuilding the read model in-place during a migration** — truncating and rebuilding while the service is live means there's a window where reads return empty results. For zero-downtime rebuilds: build into a new table name, then swap with an alias.

**Storing IDs instead of denormalized data** — if `order_summaries.customer_id` is a foreign key and the read route still joins to `customers` to get the name, the denormalization is incomplete. Store the customer name at projection time.

**Projections that call external APIs** — if `handleOrderPlaced` calls the Identity service to get the customer name, the projection is now coupled to that service's availability. Prefer: the event payload includes the customer name (denormalized at publish time), or the projection reads from a local cache populated by Identity events.
