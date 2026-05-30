---
name: model-domain-events
description: Design domain events — name them correctly, define their payload schema, distinguish domain events from integration events, and wire them to the workbench message bus
domain: cross-cutting
type: foundation
triggers:
  - "domain events"
  - "model events"
  - "event schema"
  - "event naming"
  - "domain event vs integration event"
  - "event payload"
  - "event sourcing"
  - "publish events"
  - "subscribe to events"
---

# Model Domain Events

## When to use

After aggregate design, when you need to define what the system communicates between bounded contexts. Domain events are the primary mechanism for cross-context communication in the workbench (via `bus_publish` / `bus_read`). Activate when the user asks "how do I communicate between services?", "what events should I emit?", or "how do I design an event payload?"

## Prerequisites

- Bounded contexts defined (see `define-bounded-contexts` skill)
- Aggregates designed with invariants (see `design-aggregates` skill)
- Event storm completed — events named there become the starting point here

## Domain Events vs. Integration Events vs. CRUD Events

| Type | When to use | Who publishes | Who consumes |
|------|-------------|--------------|-------------|
| **Domain Event** | Something meaningful happened in the domain | The aggregate that owns it | Other aggregates in the same context |
| **Integration Event** | A domain event that needs to cross a context boundary | The publishing context (translated) | Other bounded contexts |
| **CRUD Event** | A record was created/updated/deleted | Don't do this | Don't do this |

```
Domain event (inside Orders context):
  OrderLineItemAdded { orderId, lineItem, newTotal }
  → consumed by other aggregates inside Orders (e.g., update the cart summary)

Integration event (crosses from Orders to Fulfillment):
  OrderPlaced { orderId, customerId, lineItems, shippingAddress, placedAt }
  → Fulfillment subscribes to this and starts the pick/pack process
  → Notifications subscribes to this and sends a confirmation email
  → Note: contains ONLY what the consumer needs. Not "everything about the order."

CRUD event (antipattern):
  OrderUpdated { orderId, before: {...}, after: {...} }
  → consumer must diff before/after to understand what happened
  → forces consumers to know your internal schema
  → use a specific event name instead: OrderTotalAdjusted, OrderAddressChanged
```

## Step 1 — Name Events Correctly

```
Rules:
1. Past tense — something that HAS happened, not a command
2. Domain noun + past verb — from the ubiquitous language of the emitting context
3. Specific — describes WHAT changed, not just that something changed
4. Stable — event names appear in other teams' code; rename rarely

✓ Good:   OrderPlaced, PaymentAuthorized, ItemShipped, UserDeactivated
✗ Vague:  OrderUpdated, PaymentProcessed, ItemChanged, UserModified
✗ CRUD:   OrderCreated, PaymentInserted, ItemDeleted
✗ Command: PlaceOrder, ProcessPayment (these are commands, not events)
```

## Step 2 — Define the Event Payload

An event payload must be **self-describing** — a consumer should be able to act on it without making additional queries to the emitting service.

```
Include in the payload:
✓ The aggregate ID (always)
✓ The specific data that changed — the "what"
✓ The business context needed to act on the event — the "why"
✓ A timestamp (when it happened, not when it was published)
✓ A version field (so you can evolve the schema without breaking consumers)

Do NOT include:
✗ The entire aggregate state (that's event sourcing, a different pattern)
✗ Computed values the consumer can compute themselves from included data
✗ Internal implementation details (database IDs from another service's schema)
✗ Anything the consumer doesn't need — payload size has a cost
```

```typescript
// src/schemas/events.ts

import { z } from "zod";

// Base envelope all events share
const EventEnvelope = z.object({
  eventId: z.string().uuid(),       // unique ID for exactly-once deduplication
  eventType: z.string(),             // "OrderPlaced", "PaymentAuthorized", etc.
  aggregateId: z.string().uuid(),    // the root entity this event is about
  occurredAt: z.coerce.date(),       // when it happened in the domain
  version: z.number().int().positive().default(1),  // schema version
});

// Specific events extend the base
export const OrderPlacedEvent = EventEnvelope.extend({
  eventType: z.literal("OrderPlaced"),
  payload: z.object({
    orderId: z.string().uuid(),
    customerId: z.string().uuid(),
    lineItems: z.array(z.object({
      productId: z.string().uuid(),
      productName: z.string(),   // denormalized — consumer shouldn't need to look this up
      quantity: z.number().int().positive(),
      unitPrice: z.object({ amount: z.number(), currency: z.string() }),
    })),
    total: z.object({ amount: z.number(), currency: z.string() }),
    shippingAddress: z.object({
      line1: z.string(),
      city: z.string(),
      postalCode: z.string(),
      country: z.string(),
    }),
  }),
});

export const PaymentAuthorizedEvent = EventEnvelope.extend({
  eventType: z.literal("PaymentAuthorized"),
  payload: z.object({
    paymentId: z.string().uuid(),
    orderId: z.string().uuid(),   // the order this payment is for
    amount: z.object({ amount: z.number(), currency: z.string() }),
    authorizedAt: z.coerce.date(),
  }),
});

export type OrderPlaced = z.infer<typeof OrderPlacedEvent>;
export type PaymentAuthorized = z.infer<typeof PaymentAuthorizedEvent>;
```

## Step 3 — Publish Events via the Workbench Message Bus

```typescript
// After a successful state change in a service function, publish the event
import type { Db } from "./db";
import { OrderPlacedEvent } from "../schemas/events";

export async function placeOrder(db: Db, orderId: string): Promise<void> {
  const order = await db.tx(async (t) => {
    // 1. Load and validate state
    const order = await getOrder(t, orderId);
    if (order.lineItems.length === 0) throw new DomainError("Order must have items");

    // 2. Apply state change
    await t.none("UPDATE orders SET status='placed', placed_at=NOW() WHERE id=$1", [orderId]);
    return getOrder(t, orderId);
  });

  // 3. Publish AFTER the transaction commits (not inside it)
  const event: OrderPlaced = {
    eventId: crypto.randomUUID(),
    eventType: "OrderPlaced",
    aggregateId: order.id,
    occurredAt: new Date(),
    version: 1,
    payload: {
      orderId: order.id,
      customerId: order.customerId,
      lineItems: order.lineItems.map((li) => ({
        productId: li.productId,
        productName: li.productName,
        quantity: li.quantity,
        unitPrice: li.price,
      })),
      total: order.total,
      shippingAddress: order.shippingAddress!,
    },
  };

  // bus_publish is available as an MCP tool, or call the API directly:
  await fetch(`${process.env.MCP_SERVER_URL}/bus/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel: "orders.placed", message: event }),
  });
}
```

## Step 4 — Subscribe to Events

```typescript
// Consuming an event in another bounded context (e.g., Fulfillment)
// Run as a background worker or triggered by a queue processor

import { OrderPlacedEvent } from "../schemas/events";

async function handleOrderPlaced(rawMessage: unknown): Promise<void> {
  // Always validate incoming events — you don't control the publisher
  const event = OrderPlacedEvent.parse(rawMessage);

  // Idempotency check — the bus delivers at-least-once
  const alreadyProcessed = await db.oneOrNone(
    "SELECT 1 FROM processed_events WHERE event_id = $1",
    [event.eventId]
  );
  if (alreadyProcessed) return;

  // Handle the event
  await createFulfillmentOrder(db, event.payload);

  // Mark as processed
  await db.none(
    "INSERT INTO processed_events (event_id, processed_at) VALUES ($1, NOW())",
    [event.eventId]
  );
}
```

## Step 5 — Versioning Events

Events are published contracts. Once other services consume them, you can't remove fields. Use the `version` field to signal breaking changes.

```typescript
// Version 1 schema
OrderPlacedEvent.extend({ payload: z.object({ ... version 1 fields ... }) });

// Version 2: added shippingMethod field
// Strategy: new version = new eventType string, or version field + conditional parsing
const OrderPlacedEventV2 = EventEnvelope.extend({
  eventType: z.literal("OrderPlaced"),
  version: z.literal(2),
  payload: z.object({
    // ... all v1 fields ...
    shippingMethod: z.string(),   // new required field in v2
  }),
});

// Consumer: handle both versions during migration window
function parseOrderPlaced(raw: unknown): OrderPlaced | OrderPlacedV2 {
  const base = EventEnvelope.parse(raw);
  if (base.version === 2) return OrderPlacedEventV2.parse(raw);
  return OrderPlacedEvent.parse(raw);
}
```

**Safe changes (no version bump needed):**
- Adding an optional field
- Adding a new event type entirely

**Breaking changes (increment version):**
- Removing a field
- Changing a field's type
- Renaming a field
- Making an optional field required

## Templates

### Event catalog entry

```markdown
## Event: OrderPlaced

**Context:** Orders
**Aggregate:** Order
**Version:** 1

**When emitted:** When a customer successfully submits their order (all inventory reserved, payment initiated)

**Payload:**
| Field | Type | Description |
|-------|------|-------------|
| orderId | UUID | |
| customerId | UUID | |
| lineItems | Array | productId, productName, quantity, unitPrice |
| total | Money | amount + currency |
| shippingAddress | Address | line1, city, postalCode, country |

**Consumers:**
- Fulfillment: starts pick/pack workflow
- Notifications: sends order confirmation email
- Analytics: records conversion event

**Not included:** payment details (separate PaymentAuthorized event follows)
```

## Checklist

- [ ] All integration events named in past tense with a specific domain verb
- [ ] No CRUD events ("XUpdated" → specific event name for what changed)
- [ ] Event payload is self-describing — consumer doesn't need extra queries
- [ ] `eventId` UUID in every event (for at-least-once deduplication)
- [ ] `occurredAt` timestamp in every event (domain time, not publish time)
- [ ] `version` field in every event
- [ ] Consumers validate incoming events with Zod before processing
- [ ] Consumers implement idempotency check on `eventId`
- [ ] Event published AFTER the transaction commits (not inside it)
- [ ] Event catalog document created or updated

## Files involved

| File | Action |
|------|--------|
| `src/schemas/events.ts` | Create: Zod schemas for all integration events |
| `src/schemas/index.ts` | Update: re-export event schemas |
| `src/services/<domain>.ts` | Update: publish events after successful state changes |
| `docs/event-catalog.md` | Create/update: human-readable event catalog |
| `event-storm.md` | Update: note which events became integration events |

## Common mistakes

**Publishing inside the transaction** — if the publish call fails, the transaction commits but no event is sent. Consumers never hear about the state change. Publish after `db.tx()` resolves. For strict at-least-once guarantees, use the outbox pattern: write the event to an `outbox` table inside the transaction, have a separate process relay it.

**CRUD events** — `OrderUpdated { before, after }` forces every consumer to understand your internal data model and diff the before/after to understand what happened. Emit specific events: `OrderAddressChanged`, `OrderTotalAdjusted`. Consumers then subscribe only to what they care about.

**Embedding too much** — including the full customer profile inside `OrderPlaced` creates a snapshot coupling: if the customer schema changes, the event payload changes. Denormalize only the fields the consumer actually needs (e.g., `customerEmail` for the notification service, not the entire `Customer` object).

**Not handling idempotency** — message buses deliver at-least-once. The same event may arrive twice. Always check `eventId` against a `processed_events` table before handling.
