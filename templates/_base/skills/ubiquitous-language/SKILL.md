---
name: ubiquitous-language
description: Build and maintain the ubiquitous language for a bounded context — a shared glossary that domain experts and developers use consistently in conversation, code, documentation, and tests
domain: cross-cutting
type: foundation
triggers:
  - "ubiquitous language"
  - "domain glossary"
  - "naming conventions"
  - "what do we call this"
  - "terminology"
  - "shared vocabulary"
  - "domain language"
  - "what does X mean"
  - "anemic model"
---

# Ubiquitous Language

## When to use

Throughout the project, starting at the event storm. The ubiquitous language is not a one-time artifact — it's a living agreement that grows as your understanding of the domain deepens. Activate when the team is using different words for the same concept, when code names don't match what domain experts say, or when someone asks "what do we actually call this?"

## Prerequisites

- At least one domain expert (product owner, ops team member, customer support lead) engaged
- Event storm completed (the stickies are the first draft of the ubiquitous language)

## What Ubiquitous Language Is

The ubiquitous language is the set of terms that a bounded context uses — consistently — in:
- Conversation between developers and domain experts
- Code (class names, method names, variable names, database column names)
- Tests (scenario names, assertion messages)
- Documentation
- User interface labels

"Ubiquitous" means everywhere, not just in the code. If developers say "account" in code but business stakeholders say "subscription", that gap is a friction point where misunderstanding hides.

## Step 1 — Extract Terms from the Event Storm

Every noun and verb on a sticky note is a term candidate:
- Domain events (orange): `OrderPlaced`, `PaymentFailed` → verbs: "place", "fail"; nouns: "order", "payment"
- Commands (blue): `PlaceOrder`, `IssueRefund` → verbs: "place", "issue"; nouns: "order", "refund"
- Actors (yellow): `Customer`, `Warehouse Operator` → role names
- Policies (purple): "When order confirmed, reserve inventory" → "reserve", "inventory", "confirm"
- Read models (green): "Order summary", "Inventory level" → compound nouns

Collect all of these. For each, ask: does everyone in the room agree on what this means?

## Step 2 — Write the Glossary

Create `GLOSSARY.md` in the project root (or in each bounded context directory for large systems).

```markdown
# Glossary — [Bounded Context Name]
Last updated: [date]

## Order

**Definition:** A customer's request to purchase one or more products, from cart submission through delivery.

**Lifecycle:** draft → placed → confirmed → shipped → delivered | cancelled

**Distinguished from:**
- *Cart*: a draft order before the customer submits. "Cart" is only used before `placed`.
- *Invoice*: the billing document issued after an order is confirmed. An order can have one invoice.
- *Purchase order (PO)*: a B2B concept used in the Procurement context, not here.

**In code:**
- Table: `orders`
- Root entity: `Order`
- ID type: UUID, prefixed `ord_` in external APIs
- Status field: `order_status` enum

**In the UI:**
- Customer-facing: "Your order" / "Order #12345"
- Internal tools: "Order" (no qualifier)

---

## Payment

**Definition:** A financial transaction that authorizes or captures funds for an order.

**Distinguished from:**
- *Charge*: the term Stripe uses; we use "payment" in our domain and translate at the Stripe ACL
- *Invoice*: the document; a payment settles an invoice
- *Refund*: a separate domain concept, modeled as `Refund` not as a negative `Payment`

**States:** pending → authorized → captured | failed | refunded

**In code:**
- Table: `payments`
- Aggregate root: `Payment`

---

## Fulfillment

**Definition:** The physical process of picking, packing, and shipping items from a warehouse order.

**Owned by:** the Fulfillment bounded context (not Orders — Orders knows fulfillment status, it doesn't own the process)

**Distinguished from:**
- *Shipping*: the act of handing off to a carrier. Fulfillment includes everything before that.
- *Delivery*: the carrier's job, after fulfillment hands off.

---

## Customer

**Definition:** A person or organization that has placed at least one order. An unregistered visitor who has items in a cart is a *Visitor*, not a Customer.

**Distinguished from:**
- *User*: the authentication identity (a Customer may have multiple Users if they share an account)
- *Visitor*: pre-registration or pre-order; becomes a Customer at first `OrderPlaced` event
- *Contact* (in CRM context): a broader term used by the marketing team; we map Customer → Contact at the CRM ACL

---
```

## Step 3 — Enforce in Code

The glossary is only valuable if the code uses it. Do a naming audit when the glossary stabilizes:

```bash
# Find divergence between glossary terms and code
# Example: if the glossary says "OrderPlaced" but code uses "order_created"
grep -r "order_created\|orderCreated\|create_order" src/ --include="*.ts"
grep -r "charge\|payment_intent" src/ --include="*.ts"  # should use "payment", not Stripe's term
grep -r "user" src/schemas/ --include="*.ts" | grep -v "userId\|createdBy"  # check if "user" leaks where "customer" belongs
```

Rename anything that diverges. This is not cosmetic cleanup — divergent naming means the code and the domain model are drifting apart.

```typescript
// ✗ Using the external system's vocabulary in your domain
await stripe.paymentIntents.create({ ... });
// Store as "payment", translate at the boundary:
const payment = await createPayment(db, {
  orderId,
  amount,
  stripePaymentIntentId: result.id,  // only reference to Stripe, in one field
});

// ✓ Using the Fulfillment context's term, not the logistics provider's
// If ShipStation calls it a "shipment" but your domain calls it "fulfillment order":
const fulfillmentOrder = translateFromShipStation(shipStationOrder);

// ✗ "User" leaking into the Orders context
const userId = order.userId;     // Who placed the order is a "customer"
const customerId = order.customerId; // ✓ Uses the domain term
```

## Step 4 — Keep It Alive

The glossary rots as fast as any other documentation. Prevent this:

```
Rules for maintaining the glossary:
1. Any PR that introduces a new domain term requires a glossary entry in the same PR
2. Any PR that renames a domain concept updates the glossary in the same PR
3. If you hear a domain expert use a term not in the glossary, add it before the next standup
4. Disputed terms get a "⚠️ DISPUTED" marker and a note — don't silently resolve the disagreement in code
5. Terms that no longer apply get a "~~strikethrough~~" and a deprecation note, not deletion
```

## Step 5 — Naming Patterns by Layer

Apply the ubiquitous language consistently across all layers:

```typescript
// Database: snake_case of the domain term
// orders table, order_line_items table, order_status column

// Zod schema / TypeScript type: PascalCase
type Order = z.infer<typeof OrderSchema>;
type OrderLineItem = z.infer<typeof OrderLineItemSchema>;

// Service function: camelCase, domain verb + domain noun
async function placeOrder(db: Db, orderId: string): Promise<Order>
async function cancelOrder(db: Db, orderId: string, reason: string): Promise<Order>
async function getOrderById(db: Db, orderId: string): Promise<Order | null>

// HTTP route: kebab-case URL + domain verb as path
POST /orders/:orderId/place
POST /orders/:orderId/cancel
GET  /orders/:orderId

// Domain event: PascalCase, noun + past verb
"OrderPlaced", "OrderCancelled", "OrderFulfilled"

// Test scenario: "given [state], when [command], then [outcome]"
it("cancels an order when the customer requests it before shipment")
it("rejects a cancellation if the order has already shipped")
```

## Templates

### `GLOSSARY.md` entry template

```markdown
## [Term]

**Definition:** [One or two precise sentences. What it IS, stated positively.]

**Lifecycle (if applicable):** [state1 → state2 → state3]

**Distinguished from:**
- *[Similar term]*: [how they differ]

**In code:**
- Table: `[table_name]`
- Type: `[TypeScriptTypeName]`
- ID field: `[fieldName]`

**In the UI:** [What users see]

**⚠️ DISPUTED (if applicable):** [what's unclear, who holds which view, resolution target date]
```

## Checklist

- [ ] `GLOSSARY.md` created with at least one entry per major domain noun from the event storm
- [ ] Each entry has a definition, a "distinguished from" section, and a code reference
- [ ] No code uses an external system's vocabulary where a domain term exists (Stripe "charge" → our "payment")
- [ ] No context-bleeding: "User" doesn't appear in service code that belongs to the Orders context
- [ ] All Zod type names, service function names, and HTTP routes use glossary terms
- [ ] Disputed terms are marked `⚠️ DISPUTED`, not silently resolved in code
- [ ] Team has agreed: new domain terms require a glossary PR before or alongside the feature PR

## Files involved

| File | Action |
|------|--------|
| `GLOSSARY.md` | Create: domain glossary, one entry per major term |
| `event-storm.md` | Update: ensure event names use the agreed terms |
| `src/schemas/*.ts` | Update: rename any types that diverge from the glossary |
| `src/services/*.ts` | Update: rename any functions that diverge |
| `supabase/migrations/` | Update (new migration): rename columns that diverge |

## Common mistakes

**Separate vocabularies for developers and domain experts** — if your team says "user account" in code but the business says "subscription", every conversation requires translation, bugs hide in the translation layer, and new developers inherit the confusion. The cost of renaming is real but bounded; the cost of permanent confusion is unbounded.

**Putting the glossary in a wiki nobody reads** — the glossary lives closest to the code: in the repository, versioned alongside the code it describes. A Confluence page that diverges from reality is worse than no glossary.

**One glossary for the whole system** — a large system will have the same word mean different things in different contexts ("account" in billing vs. identity vs. orders). Each bounded context has its own glossary. The context map describes how terms relate across contexts, not a merged single definition.

**Resolving disputes in code without acknowledging them** — if two domain experts disagree on whether a "return" and a "refund" are the same concept, a developer who silently picks one has made a business decision they're not authorized to make. Mark it disputed, escalate, get alignment.
