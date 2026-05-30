---
name: design-aggregates
description: Design aggregates — the consistency boundaries inside a bounded context. Choose aggregate roots, define invariants, size aggregates correctly, and map them to Zod schemas and service functions
domain: cross-cutting
type: foundation
triggers:
  - "aggregate"
  - "aggregate root"
  - "aggregate design"
  - "consistency boundary"
  - "invariant"
  - "how to model"
  - "domain model"
  - "entity vs value object"
---

# Design Aggregates

## When to use

After bounded contexts are defined, before writing schemas or services. Aggregates define the consistency boundaries inside a bounded context — what must be updated together, atomically, in a single transaction. Get aggregates wrong and you'll either have race conditions (aggregate too small) or performance problems (aggregate too large). Activate when the user is designing a new domain model or asks "how should I model this?"

## Prerequisites

- Bounded contexts defined (see `define-bounded-contexts` skill)
- Domain events and their invariants documented (see `event-storming` skill)

## Core Concepts

### Aggregate

A cluster of domain objects (entities + value objects) that must be kept consistent with each other. All changes to objects inside an aggregate happen together in one transaction through a single entry point: the **aggregate root**.

```
Aggregate: Order
├── Aggregate Root: Order (entity with an identity — OrderId)
├── Entities: OrderLineItem (has its own identity, LineItemId)
└── Value Objects: Money (amount + currency), ShippingAddress (no identity, compared by value)

Invariant: The sum of all line items must equal Order.total
           No OrderLineItem can have quantity <= 0
```

### Aggregate Root

The single entry point for all operations on an aggregate. External code never holds direct references to non-root objects inside an aggregate — only the root. This enforces that invariants are always checked.

### Invariant

A business rule that must always be true within the aggregate's boundary. The aggregate is responsible for enforcing it. If an operation would violate an invariant, the operation must fail — not silently skip, not log and continue.

### Entity

An object with a unique identity that persists over time. Two entities with the same data but different IDs are different things. Example: `Order#123` and `Order#456` are different even if they have the same items.

### Value Object

An object defined entirely by its attributes. No identity. Compared by value. Immutable. Example: `Money { amount: 10.00, currency: "USD" }` — two Money objects with the same values are the same.

## Step 1 — Identify Aggregates from Domain Events

Each domain event is owned by exactly one aggregate. Group events that must happen together (atomically) inside one aggregate.

```
Events that belong together:
- OrderLineItemAdded, OrderLineItemRemoved, OrderTotalRecalculated
  → All belong to the Order aggregate (total is always consistent with line items)

Events that do NOT belong together:
- OrderPlaced, PaymentAuthorized
  → Separate aggregates — payment happens after order, in a separate system
    (Order knows about payment status, but doesn't own the payment object)
```

**Decision rule:** If two things must always be consistent at the same moment, they belong in the same aggregate. If they can be eventually consistent, they belong in different aggregates.

## Step 2 — Size the Aggregate Correctly

The most common mistake is aggregates that are too large.

```
Red flags for an aggregate that's too large:
- It spans what two different domain experts would call separate "things"
- Operations on one part of the aggregate never touch other parts
- Saving the aggregate requires locking a large, frequently-written table
- Two users working on "different parts" of the aggregate conflict constantly

Red flags for an aggregate that's too small:
- You can't enforce the invariant without loading another aggregate
- Transactions span multiple aggregates routinely
- You need a "saga" for operations that feel like they should be atomic

Heuristic: start with the smallest aggregate that can enforce all its invariants.
You can make it larger later; making it smaller later requires data migrations.
```

## Step 3 — Define the Invariants

Write each invariant as a precise, testable statement in domain language.

```typescript
// Invariants for the Order aggregate:
// 1. Order must have at least one line item to be placed
// 2. Total must equal sum(lineItem.price * lineItem.quantity) for all line items
// 3. A cancelled order cannot have items added to it
// 4. An order cannot be placed if any line item quantity <= 0

class Order {
  // The aggregate root enforces invariants in every mutating method
  addItem(productId: string, price: Money, qty: number): void {
    if (this.status === "cancelled") throw new DomainError("Cannot modify a cancelled order");
    if (qty <= 0) throw new DomainError("Quantity must be positive");
    this.lineItems.push(new OrderLineItem(productId, price, qty));
    this.recalculateTotal(); // invariant 2 always enforced
  }

  place(): void {
    if (this.lineItems.length === 0) throw new DomainError("Order must have at least one item");
    this.status = "placed";
    this.domainEvents.push(new OrderPlaced(this.id, this.total));
  }
}
```

## Step 4 — Map Aggregates to the Workbench

In the workbench (TypeScript + Fastify + Zod), aggregates map to:

| DDD Concept | Workbench Equivalent |
|-------------|---------------------|
| Aggregate schema | Zod schema in `src/schemas/<domain>.ts` |
| Aggregate root | The top-level Zod object with an `id` field |
| Value object | Zod object without an `id` field, used as a nested type |
| Repository | Service in `src/services/<domain>.ts` with `find`, `save`, `delete` |
| Domain event | Emitted to Redis Streams via `bus_publish` after a state change |
| Invariant enforcement | Validated in the service method before any DB write |

```typescript
// src/schemas/order.ts — aggregate schema
import { z } from "zod";

// Value Object: Money (no id, compared by value)
export const MoneySchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
});

// Value Object: ShippingAddress
export const ShippingAddressSchema = z.object({
  line1: z.string().min(1),
  city: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().length(2),
});

// Entity inside aggregate (has its own id)
export const OrderLineItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  price: MoneySchema,
  quantity: z.number().int().positive(),
});

// Aggregate Root: Order
export const OrderSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  status: z.enum(["draft", "placed", "confirmed", "shipped", "delivered", "cancelled"]),
  lineItems: z.array(OrderLineItemSchema).min(1),
  total: MoneySchema,
  shippingAddress: ShippingAddressSchema.optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Order = z.infer<typeof OrderSchema>;
export type OrderLineItem = z.infer<typeof OrderLineItemSchema>;
export type Money = z.infer<typeof MoneySchema>;
```

```typescript
// src/services/orders.ts — repository + invariant enforcement
import type { Db } from "./db";
import { OrderSchema, type Order } from "../schemas/order";
import { DomainError } from "../lib/errors";

export async function getOrder(db: Db, orderId: string): Promise<Order> {
  const row = await db.one("SELECT * FROM orders WHERE id = $1", [orderId]);
  return OrderSchema.parse(row); // validates on read too
}

export async function addLineItem(
  db: Db,
  orderId: string,
  productId: string,
  price: { amount: number; currency: string },
  quantity: number
): Promise<Order> {
  const order = await getOrder(db, orderId);

  // Invariant check — not in the DB, not in a Zod refinement
  if (order.status === "cancelled") {
    throw new DomainError("Cannot modify a cancelled order");
  }
  if (quantity <= 0) {
    throw new DomainError("Quantity must be positive");
  }

  // All DB writes for this aggregate happen in one transaction
  return db.tx(async (t) => {
    await t.none(
      "INSERT INTO order_line_items (id, order_id, product_id, price_amount, price_currency, quantity) VALUES ($1, $2, $3, $4, $5, $6)",
      [crypto.randomUUID(), orderId, productId, price.amount, price.currency, quantity]
    );
    const newTotal = await recalculateTotal(t, orderId);
    await t.none("UPDATE orders SET total_amount=$1, updated_at=NOW() WHERE id=$2", [newTotal, orderId]);
    return getOrder(t, orderId);
  });
}
```

## Step 5 — Identify Aggregate Relationships

Aggregates reference each other only by ID, never by embedding the full object.

```typescript
// ✓ Correct: Order references Customer by ID
const OrderSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(), // ID only — never embed the full Customer
  // ...
});

// ✗ Wrong: embedding another aggregate
const OrderSchema = z.object({
  id: z.string().uuid(),
  customer: CustomerSchema, // This couples Order to Customer's schema permanently
  // ...
});
```

If loading an order always requires customer data, load them separately in the service and compose at the query layer — not in the aggregate schema.

## Templates

### Aggregate design worksheet

```markdown
## Aggregate: [Name]

**Aggregate Root:** [entity name + ID type]
**Entities inside:** [list with their own IDs]
**Value Objects:** [list — no ID, compared by value]

**Invariants:**
1. [statement in domain language — not technical]
2. ...

**Domain Events emitted:**
- [EventName] — when [condition]

**Does NOT own:** [what this aggregate references by ID but doesn't control]

**Consistency requirement:** [can this be eventually consistent with X, or must it be atomic?]
```

## Checklist

- [ ] Each aggregate has exactly one root entity with a unique ID
- [ ] All invariants stated in domain language before any code is written
- [ ] Every mutating service function enforces all invariants before writing to the DB
- [ ] Value objects have no ID and are compared by value (no `id` field in their Zod schema)
- [ ] Aggregates reference other aggregates only by ID (no embedding)
- [ ] All writes to an aggregate happen in a single database transaction
- [ ] Domain events emitted after successful state changes (not inside the transaction)
- [ ] Aggregate root Zod schema in `src/schemas/`
- [ ] Repository functions in `src/services/<domain>.ts`

## Files involved

| File | Action |
|------|--------|
| `src/schemas/<domain>.ts` | Create: Zod schemas for aggregate root + entities + value objects |
| `src/schemas/index.ts` | Update: re-export new schemas |
| `src/services/<domain>.ts` | Create: repository functions with invariant enforcement |
| `supabase/migrations/` | Create: tables for aggregate root and nested entities |
| `event-storm.md` | Update: note which aggregate owns each domain event |

## Common mistakes

**Invariants in the database** — foreign key constraints and NOT NULL are valid, but business invariants (e.g., "order total must match line items") should be enforced in the service, not in a database trigger. Triggers are hard to test, hard to debug, and invisible to the domain model.

**Invariants in Zod schemas with `.refine()`** — Zod refinements run on parse, so they only protect against malformed data coming in. They don't protect against invariant violations caused by a sequence of operations on already-persisted data. Put invariants in the service, not the schema.

**Lazy-loading related aggregates inside a transaction** — if `getOrder` calls `getCustomer` inside the same transaction, you've coupled the two aggregates at the persistence level. Load related data before the transaction, pass it as parameters, or query it separately after.

**One massive aggregate** — if your aggregate root has 20 fields and 15 methods, it's probably two or three aggregates pretending to be one. Break it along the invariant lines.

**Using aggregate IDs as foreign keys without meaning** — `customerId` is a reference, not a relationship. If the Order service needs to validate that the customer exists and is active, that's a cross-context concern — handled by an API call or an event, not a foreign key constraint.
