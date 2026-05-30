---
name: define-bounded-contexts
description: Take the output of Event Storming and draw explicit bounded context boundaries — name each context, assign its domain events, define the relationships between contexts, and map each context to a service or module
domain: cross-cutting
type: foundation
triggers:
  - "bounded context"
  - "context map"
  - "context boundaries"
  - "domain boundaries"
  - "how to split services"
  - "microservice boundaries"
  - "where to draw the line"
  - "context mapping"
---

# Define Bounded Contexts

## When to use

After Event Storming, before scaffold. Bounded contexts define where the lines are between different parts of the system. Get these wrong and everything that follows — database design, API shape, team organization, service split — is built on a broken foundation. Activate when the user asks "how do we split this?", "what are the bounded contexts?", or when an event storm has been completed.

## Prerequisites

- Completed event storm with domain events on a timeline (see `event-storming` skill)
- Identified the actors, commands, and policies for each event cluster
- Hotspots resolved (or at least documented)

## What a Bounded Context Is

A bounded context is an explicit boundary within which a particular domain model applies consistently. Inside the boundary, every term means one specific thing. The same word in two different contexts may mean different things.

**Classic example:** "Account" in a banking domain
- In the **Retail Banking** context: a customer's checking or savings account with a balance
- In the **Loans** context: a mortgage account with principal, interest, and amortization schedule
- In the **Identity** context: a login credential (username + password + MFA)

These are three different models. Trying to build one unified "Account" model that serves all three is how you get a 47-column table with nullable fields and spaghetti validation logic.

## Step 1 — Identify Boundaries from the Event Storm

Look for these signals in your event storm output:

```
Boundary signal                     What it means
─────────────────────────────────   ─────────────────────────────────────────
Different nouns for the same thing  Two contexts use "Account" differently → split
Handoff point between actors        Customer → Warehouse → Shipping → Customer
Events that only one team cares     If ops never asks about UserRegistered, it's in a different context
External system crossing            Any integration with an external system = a context boundary
Disagreement about what X means     Contested definitions = boundary in disguise
Different transaction rates         High-frequency events mixed with low-frequency → separate
```

Draw a circle (or box) around each cluster of related events. Name it with a noun from the domain, not a technical term.

```
✓ Good context names: Orders, Fulfillment, Billing, Catalog, Identity, Notifications
✗ Bad context names: DatabaseLayer, ApiGateway, UserService, DataManager
```

## Step 2 — Document Each Context

For each bounded context, write a one-paragraph description that includes:
1. What it owns (its domain events and commands)
2. What its core invariant is (the rule it always enforces)
3. What it does NOT do (explicit boundary)

```markdown
## Orders

Owns the lifecycle of a customer's purchase from cart to confirmed order.
Core invariant: an order cannot be placed if any line item is out of stock.
Does NOT handle payment processing (that's Billing), inventory tracking (that's Catalog),
or physical fulfillment (that's Fulfillment).

Owned domain events:
- CartItemAdded, CartItemRemoved, CartAbandoned
- OrderPlaced, OrderConfirmed, OrderCancelled

Consumed events (from other contexts):
- PaymentAuthorized (from Billing) → triggers OrderConfirmed
- StockDepleted (from Catalog) → triggers OrderCancelled (if pending)
```

## Step 3 — Draw the Context Map

The context map shows the relationships between bounded contexts. Each relationship has a type:

| Pattern | Symbol | Meaning |
|---------|--------|---------|
| **Partnership** | `[A] ↔ [B]` | Teams coordinate changes together (tight coupling, both benefit) |
| **Shared Kernel** | `[A] ⊂⊃ [B]` | Shared subset of the domain model both teams maintain together |
| **Customer/Supplier** | `[Supplier] → [Customer]` | Supplier publishes events; customer consumes. Customer can request changes. |
| **Conformist** | `[Upstream] ⇒ [Downstream]` | Downstream conforms to upstream's model, no negotiation |
| **Anti-Corruption Layer** | `[A] -ACL→ [B]` | Translation layer prevents an external model leaking in |
| **Open Host Service** | `[A] -OHS→ [*]` | Published protocol for others to integrate against |
| **Published Language** | `[A] -PL→ [*]` | Shared event/API schema (JSON Schema, Protobuf, OpenAPI) |

```
Example context map:

Identity -OHS→ Orders       (Orders calls Identity's auth API)
Orders -Customer/Supplier→ Billing   (Orders places, Billing processes)
Billing -OHS→ Orders        (Billing publishes PaymentAuthorized events)
Orders -Customer/Supplier→ Fulfillment
Catalog → Orders             (Orders conforms to Catalog's product schema)
Fulfillment -ACL→ ShipStation  (ACL translates ShipStation's model to our domain)
```

## Step 4 — Map Contexts to the Workbench Architecture

Each bounded context maps to a concrete technical unit:

| Context size | Workbench mapping |
|-------------|------------------|
| Small (2–5 domain events, simple CRUD) | A route module + service in a fullstack project |
| Medium (10–20 events, own lifecycle) | A dedicated service in a `microservices` project |
| Large (owns significant complexity) | A separate project registered in the workbench |

```
# context_map.md template

## Context → Service Mapping

| Bounded Context | Type | Workbench Unit | Database | Team |
|----------------|------|---------------|----------|------|
| Identity | Core domain | auth-service (microservices) | auth_db | Platform |
| Orders | Core domain | orders-service (microservices) | orders_db | Commerce |
| Catalog | Supporting | catalog-service (microservices) | catalog_db | Commerce |
| Notifications | Generic | notifications-service | notifications_db | Platform |
| Analytics | Generic | analytics-service | analytics_db | Data |

## Integration Points (events that cross context boundaries)

| Source Context | Event | Consumer Context | Integration Mechanism |
|---------------|-------|-----------------|----------------------|
| Orders | OrderPlaced | Fulfillment | Redis Streams (bus_publish) |
| Orders | OrderPlaced | Notifications | Redis Streams |
| Billing | PaymentAuthorized | Orders | Redis Streams |
| Billing | PaymentFailed | Orders | Redis Streams |
| Catalog | StockDepleted | Orders | Redis Streams |
```

## Step 5 — Validate the Boundaries

Ask these questions about each proposed boundary. If the answer is "no", reconsider the split:

```
✓ Can this context be deployed independently?
✓ Does this context have a single team (or single developer) who owns it?
✓ Is the core invariant enforceable entirely within this context's data?
✓ Does this context have a clear name that a domain expert recognizes?
✓ Can you describe what this context does in one sentence without mentioning another context?
```

If a context can't enforce its invariant alone, it probably needs access to data it doesn't own — that's usually a sign the boundary is in the wrong place.

## Templates

### `event-storm.md` context section (minimal)

```markdown
## Bounded Contexts

### [Context Name]
**Responsibility:** [one sentence]
**Core invariant:** [what must always be true, stated in domain language]
**Owns these events:** [list]
**Consumes from:** [context → event → why]
**Publishes to:** [context → event → why]
**Does NOT handle:** [explicit exclusion]
```

### `BOUNDED_CONTEXTS.md` (standalone artifact)

```markdown
# Bounded Contexts — [Project Name]
Last updated: [date]

## Summary Map
[ASCII or text description of context relationships]

## Contexts

### [Context Name]
...

## Cross-Context Event Flows

### [User journey / scenario name]
1. [Actor] → [Command] → [Event] ([Context])
2. [Event] triggers [Policy] → [Command] → [Event] ([Next Context])
...
```

## Checklist

- [ ] Every major cluster of domain events from the event storm is assigned to a named context
- [ ] Each context has a one-sentence responsibility description
- [ ] Each context's core invariant is stated in domain language
- [ ] Every event that crosses a context boundary is documented as an integration point
- [ ] Each integration relationship has a named pattern (Customer/Supplier, ACL, etc.)
- [ ] Each context maps to a concrete workbench unit (route module, service, or project)
- [ ] No context owns data that another context's invariant depends on
- [ ] Context names are recognized by domain experts, not just developers
- [ ] `BOUNDED_CONTEXTS.md` or updated `event-storm.md` created in the project

## Files involved

| File | Action |
|------|--------|
| `event-storm.md` | Update: add/refine the Bounded Contexts section |
| `BOUNDED_CONTEXTS.md` | Create (large projects): standalone context map |
| `context_map.md` | Create (microservices): integration points and service mapping |

## Common mistakes

**One context per database table** — bounded contexts are about behavior and consistency, not storage. A context may use dozens of tables. Mapping 1:1 to tables produces microservices that can't enforce their invariants.

**Letting "generic" determine the boundary** — "generic subdomain" (email sending, logging) means it's not core to the business, not that it's trivial to build. Still deserves its own context if it has its own lifecycle.

**Sharing a database between contexts** — this is the most common way to accidentally couple contexts. If two services share a database, they share the responsibility for that data's consistency. Context boundaries require context-owned data.

**Getting the relationship direction wrong** — in a Customer/Supplier relationship, the supplier publishes, the customer conforms. Drawing the arrow the wrong way implies the customer can dictate changes to the supplier, which is often not true.

**Designing contexts for technical convenience** — "I'll put all the CRUD operations in one service" is a technical boundary, not a domain boundary. Domain boundaries survive technical refactors; technical boundaries don't survive domain changes.
