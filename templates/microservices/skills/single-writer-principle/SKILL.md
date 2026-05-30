---
name: single-writer-principle
description: Enforce that exactly one service writes to each event stream — establish stream ownership, detect and prevent multiple-writer violations, and design topology so ownership is unambiguous
domain: microservices
type: microservices
triggers:
  - "single writer"
  - "stream ownership"
  - "who owns this event"
  - "multiple writers"
  - "event ordering"
  - "stream topology"
  - "event ownership"
  - "which service publishes"
---

# Single-Writer Principle

## When to use

When designing which service publishes to which channel, or when you discover that two services are both publishing to the same stream. The single-writer principle (from Bellemare's *Building Event-Driven Microservices*) states: exactly one service is allowed to write to any given event stream. Multiple writers destroy ordering guarantees, make event provenance ambiguous, and create implicit coupling between services that appear independent. Activate when defining integration events, when reviewing a new service's publishing behavior, or when debugging event ordering issues.

## Prerequisites

- Bounded contexts defined (see `define-bounded-contexts` skill)
- Domain events identified for at least two bounded contexts
- Message bus configured (Redis Streams via `bus_publish`)

## The Rule

```
For every channel (event stream), exactly one bounded context is the writer.
All other bounded contexts are readers.

✓ Orders service   → publishes to "orders.*"
✓ Billing service  → publishes to "billing.*"
✓ Fulfillment      → publishes to "fulfillment.*"

✗ Orders service   → publishes to "orders.placed"
  Billing service  → also publishes to "orders.placed"  ← violation
```

When two services write to the same channel:
- **Ordering breaks**: Redis Streams and Kafka guarantee ordering per-channel. Two concurrent writers produce interleaved, non-deterministic ordering.
- **Provenance breaks**: consumers can't tell which service produced an event or what invariants were enforced.
- **Coupling hides**: both services must coordinate schema changes silently — a deployment dependency that isn't visible in code.

## Step 1 — Document Stream Ownership

Create `STREAM_OWNERSHIP.md` at the repository root (or per-service in a monorepo).

```markdown
# Event Stream Ownership

Last updated: [date]

## Naming Convention

Channels follow the pattern: `<bounded-context>.<event-name>`

- `orders.placed`      ← Orders context is the sole writer
- `orders.cancelled`   ← Orders context is the sole writer
- `billing.authorized` ← Billing context is the sole writer
- `fulfillment.shipped` ← Fulfillment context is the sole writer

## Ownership Table

| Channel pattern | Owner (sole writer) | Consumers |
|----------------|---------------------|-----------|
| `orders.*` | orders-service | fulfillment-service, notifications-service, analytics-service |
| `billing.*` | billing-service | orders-service, notifications-service |
| `fulfillment.*` | fulfillment-service | orders-service, notifications-service |
| `catalog.*` | catalog-service | orders-service |

## Prohibited Patterns

The following are explicitly forbidden:
- Any service other than `orders-service` publishing to `orders.*`
- Any service publishing to a channel it does not own
- Shared channels with multiple writers

## When a new event is needed

1. Identify which bounded context owns the state change that causes the event.
2. That context is the publisher. No exceptions.
3. Add the channel to this table before implementing.
4. If the event crosses a context boundary, the owning context publishes it;
   the consuming context subscribes and translates to its own internal model.
```

## Step 2 — Enforce Ownership in Code

Make it impossible (or at least loud) to publish to a channel you don't own.

```typescript
// src/lib/bus.ts — typed, ownership-aware publish wrapper

// Declare which channels this service owns
const OWNED_CHANNELS = new Set([
  "orders.placed",
  "orders.confirmed",
  "orders.cancelled",
  "orders.line-item-added",
]);

export async function publish(channel: string, payload: unknown): Promise<void> {
  if (!OWNED_CHANNELS.has(channel)) {
    // Throw at runtime — makes the violation immediately visible in logs and tests
    throw new Error(
      `Single-writer violation: this service does not own channel "${channel}". ` +
      `Owned channels: ${[...OWNED_CHANNELS].join(", ")}`
    );
  }

  await fetch(`${process.env.MCP_SERVER_URL}/bus/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, message: payload }),
  });
}

// TypeScript: make owned channels a union type for compile-time enforcement
type OwnedChannel = "orders.placed" | "orders.confirmed" | "orders.cancelled" | "orders.line-item-added";

export async function publishTyped(channel: OwnedChannel, payload: unknown): Promise<void> {
  // TypeScript rejects any channel string not in the union at compile time
  await publish(channel, payload);
}
```

## Step 3 — Naming Convention That Makes Ownership Obvious

The channel name encodes the owner. Any developer reading a `bus_publish` call can immediately identify whether the call is legal.

```
Convention: <context>.<event-name>

orders.placed           → written by: Orders context
orders.cancelled        → written by: Orders context
billing.payment-authorized → written by: Billing context
fulfillment.item-picked → written by: Fulfillment context

Wildcards for subscribing:
orders.*                → subscribe to all Order events
*.failed                → subscribe to all failure events across contexts (use sparingly)
```

## Step 4 — Handle Cross-Context Reactions Without Violating Ownership

A common temptation: Billing wants to publish `orders.payment-confirmed` to tell Orders the payment was authorized. **Don't do it.** Billing doesn't own `orders.*`.

```
✗ Wrong:
  Billing publishes "orders.payment-confirmed"
  → Billing is writing to Orders' stream
  → Orders' stream now has events that Orders' invariants didn't enforce

✓ Correct:
  Billing publishes "billing.payment-authorized"   ← Billing owns this
  Orders subscribes to "billing.payment-authorized"
  Orders applies its own state change (OrderConfirmed)
  Orders publishes "orders.confirmed"              ← Orders owns this
```

Each context translates incoming events into its own internal model and its own events. The consuming context is responsible for understanding what an incoming event means for its own state.

```typescript
// orders-service/src/projections/billing.ts
// Orders subscribes to billing events and reacts with its own state changes

export async function handlePaymentAuthorized(
  db: Db,
  event: PaymentAuthorized
): Promise<void> {
  const order = await getOrderByPaymentId(db, event.payload.orderId);
  if (!order) return;  // payment for an order we don't know — ignore

  // Orders applies its own invariants and emits its own event
  await confirmOrder(db, order.id);  // this publishes "orders.confirmed"
}
```

## Step 5 — Audit Existing Services

For existing systems, audit who publishes what:

```bash
# Find all bus_publish / fetch('/bus/publish') calls across all services
grep -r "bus/publish\|bus_publish" apps/ --include="*.ts" -l

# For each file found, check which channels are published
grep -A2 "bus/publish\|bus_publish" apps/orders-service/src/**/*.ts

# Build the actual ownership map from code, compare to STREAM_OWNERSHIP.md
# Any channel published by more than one service is a violation
```

```typescript
// src/__tests__/bus-ownership.test.ts — automated ownership check
import { OWNED_CHANNELS } from "../lib/bus";

it("does not attempt to publish to channels owned by other services", async () => {
  // Grep all publish calls in this service's source and verify they're in OWNED_CHANNELS
  // This is a lightweight static check that runs in CI
  const sourceFiles = await glob("src/**/*.ts");
  for (const file of sourceFiles) {
    const content = await readFile(file, "utf-8");
    const matches = content.matchAll(/publish\("([^"]+)"/g);
    for (const match of matches) {
      const channel = match[1];
      expect(OWNED_CHANNELS.has(channel)).toBe(true);
    }
  }
});
```

## Checklist

- [ ] `STREAM_OWNERSHIP.md` created: every channel has exactly one named owner
- [ ] Channel naming follows `<context>.<event-name>` convention
- [ ] `src/lib/bus.ts` wrapper defines `OWNED_CHANNELS` set and throws on violations
- [ ] TypeScript union type for owned channels (compile-time enforcement)
- [ ] No service publishes to a channel it doesn't own (verified by grep or ownership test)
- [ ] Cross-context reactions go through: subscribe to foreign event → apply own state change → publish own event
- [ ] New channels added to `STREAM_OWNERSHIP.md` before implementation

## Files involved

| File | Action |
|------|--------|
| `STREAM_OWNERSHIP.md` | Create: channel ownership table, naming convention, prohibited patterns |
| `src/lib/bus.ts` | Create/update: ownership-aware `publish` wrapper with `OWNED_CHANNELS` |
| `src/projections/<foreign-context>.ts` | Create: handlers for events from other contexts |
| `src/__tests__/bus-ownership.test.ts` | Create: static ownership audit test |

## Common mistakes

**"It's just one extra event"** — the violation always seems harmless at the time. "Billing just needs to emit one event to the orders channel." Six months later, Orders' stream has events from three services, ordering is broken under concurrent load, and no one remembers why Billing writes there. The rule is absolute; the workaround is always to create a new channel the publishing service owns.

**Shared "notifications" or "events" channel** — a catch-all channel that all services write to is the worst form of the violation. Every consumer must parse events from every service. Use per-context channels and subscribe with wildcards (`orders.*`) at the consumer.

**Confusing internal domain events with integration events** — internal domain events stay inside the bounded context (not on the bus). Only integration events cross context boundaries, and they are always published by the context that owns the underlying state change.
