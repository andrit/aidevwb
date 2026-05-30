---
name: event-storming
description: Run a collaborative Event Storming workshop before any new project — surface domain events, commands, actors, and policy rules to define what the system does before writing a line of code
domain: cross-cutting
type: foundation
triggers:
  - "event storming"
  - "event storm"
  - "domain discovery"
  - "starting a new project"
  - "before we build"
  - "what should we build"
  - "domain events"
  - "workshop"
  - "big picture"
---

# Event Storming

## When to use

**Mandatory before every new project.** Run this before scaffolding, before schema design, before any code. Event Storming surfaces what the system does (domain events) and who causes it (commands, actors, policies) before locking in technical decisions. Skip it and you will rewrite things you didn't need to build and miss things you did.

Activate when the user says "we're starting a new project", "help me design this system", "what should we build first", or any time a blank-slate project is being created.

## What Event Storming Is

Event Storming is a collaborative workshop invented by Alberto Brandolini. Domain experts and developers map a system together using sticky notes on a timeline. The output is a shared understanding of the domain — not a spec document, not a data model. It exposes:
- What the system does (domain events)
- What triggers each event (commands + actors + policies)
- Where responsibility changes hands (bounded context boundaries)
- What information decisions need (read models)
- Where the design is unclear or contested (hotspots)

## Sticky Note Vocabulary

| Color | Type | Format | Example |
|-------|------|--------|---------|
| 🟧 Orange | **Domain Event** | Past tense verb + noun | `OrderPlaced`, `PaymentFailed`, `ItemShipped` |
| 🟦 Blue | **Command** | Imperative verb + noun | `PlaceOrder`, `RefundPayment`, `ShipItem` |
| 🟨 Yellow | **Actor** | Who or what issues the command | `Customer`, `Warehouse System`, `Scheduler` |
| 🟪 Purple | **Policy / Reaction** | "When X then Y" rule | `When OrderPlaced → send confirmation email` |
| 🟩 Green | **Read Model** | Data visible to make a decision | `Order summary`, `Inventory level` |
| 🩷 Pink | **External System** | System outside your control | `Payment Gateway`, `Shipping API`, `Email Provider` |
| 🔴 Red | **Hotspot** | Disputed, unclear, or risky area | Put a red dot or sticky on anything uncertain |

## Workshop Format

### Phase 1 — Big Picture (1–2 hours)
Goal: surface all domain events without constraints.

**Steps:**
1. Give everyone orange stickies. The rule: one event per sticky, past tense.
2. Everyone writes domain events simultaneously for 10–15 minutes — no discussion, just write.
3. Place all events on the wall in rough timeline order (left = earlier, right = later).
4. Read through the timeline together. Remove duplicates. Ask "did anything happen between X and Y?" Add missing events.
5. Mark hotspots (red) anywhere there's confusion or disagreement.

**Target output:** 30–100 domain events on a timeline, all hotspots flagged.

### Phase 2 — Process Level (1–2 hours)
Goal: add the why and who behind each event.

For each cluster of domain events:
1. Add the **command** that caused each event (blue sticky, to the left of the event).
2. Add the **actor** who issued the command (yellow sticky, above the command).
3. Add **policies** that react to events and trigger new commands (purple sticky, between event and resulting command).
4. Add **read models** that actors need before issuing a command (green sticky, above the command).
5. Add **external systems** involved (pink sticky).

**Target output:** A full causal chain: Actor → reads [Read Model] → issues [Command] → causes [Domain Event] → triggers [Policy] → issues [Command] → …

### Phase 3 — Context Boundaries (30–60 minutes)
Goal: draw the bounded context lines.

1. Look for natural breaks in the timeline where the "subject" changes — from customer-facing to warehouse-facing, from order management to billing.
2. Draw lines (physical tape or a drawn boundary) around each cluster.
3. Name each bounded context. The name should come from the domain, not the technology.
4. Identify relationships between contexts (which events cross boundaries? who consumes what?).

**Target output:** Named bounded contexts with clear responsibilities → input for `define-bounded-contexts` skill.

## Running Remotely

Without a physical wall, use a collaborative whiteboard tool:

```
Recommended tools:
- Miro (free tier works for small teams): miro.com
- FigJam: figma.com/figjam
- Excalidraw (open source, no account): excalidraw.com
- Lucidspark

Template approach: Create sticky note shapes with a legend in the top-left corner.
Use the tool's "timer" feature for the 10-minute silent writing phase.
```

## Capturing the Output

After the workshop, create an `event-storm.md` in the project directory. This becomes the living record of your domain understanding.

```markdown
# Event Storm — [Project Name]
**Date:** [YYYY-MM-DD]
**Participants:** [names and roles]

## Domain Events (timeline order)

### [Bounded Context Name]
1. UserRegistered — triggered by: RegisterUser command (User actor)
2. EmailVerificationSent — triggered by: When UserRegistered policy → SendVerificationEmail command (System)
3. EmailVerified — triggered by: VerifyEmail command (User, needs: email token read model)
4. AccountActivated — triggered by: When EmailVerified policy → ActivateAccount command (System)

### [Next Bounded Context]
...

## Hotspots

| Hotspot | Why it's unclear | Owner | Resolution |
|---------|-----------------|-------|------------|
| How do we handle unverified users who try to place orders? | Two opinions in the room | [name] | UNRESOLVED |
| Does inventory check happen before or after payment? | Affects failure modes | [name] | Agreed: before payment |

## Bounded Contexts Identified

| Context | Responsibility | Domain Events it owns |
|---------|---------------|----------------------|
| Identity | User registration, auth, sessions | UserRegistered, EmailVerified, AccountActivated |
| Catalog | Products, pricing, availability | ProductListed, PriceChanged, StockDepleted |
| Orders | Cart, checkout, order lifecycle | OrderPlaced, OrderCancelled, OrderFulfilled |
| Payments | Payment processing, refunds | PaymentAuthorized, PaymentFailed, RefundIssued |
| Fulfillment | Warehouse ops, shipping | ItemPicked, OrderShipped, DeliveryConfirmed |

## External Systems

| System | What we receive | What we send |
|--------|----------------|-------------|
| Stripe | payment-confirmed webhook | charge request |
| SendGrid | — | transactional emails |
| ShipStation | tracking updates | ship order request |

## Key Policy Rules

1. **When OrderPlaced → reserve inventory** (Inventory context listens)
2. **When PaymentFailed → release inventory reservation** (compensating action)
3. **When AllItemsPicked → trigger shipping label creation** (Fulfillment → ShipStation)
```

## Minimal Version (Solo or Async)

If working alone or with remote stakeholders who can't do a synchronous workshop:

1. Write all the domain events you know about (orange stickies / bullet list)
2. Order them in a timeline
3. For each event: who caused it? What rule triggered it? What information was needed?
4. Draw the context boundaries based on the clusters that emerge
5. Document hotspots — things you're uncertain about — and get answers before designing

A 30-minute solo event storm is better than going straight to database schema.

## What to Do After

1. Resolve all hotspots before writing code — these are your design risks
2. Use the bounded context map as input to `define-bounded-contexts`
3. Use the domain events list as input to `model-domain-events`
4. Use the ubiquitous language from the stickies as input to `ubiquitous-language`
5. Map bounded contexts to the workbench project type and scaffold accordingly

## Checklist

- [ ] All domain events written in past tense (not "create order" — "OrderPlaced")
- [ ] Every event has a command + actor that caused it
- [ ] Every command has a read model (what the actor sees before deciding)
- [ ] Policies documented as "When [Event] then [Command]"
- [ ] External systems identified (they become integration points you don't control)
- [ ] Every hotspot has an owner and a resolution status
- [ ] Bounded contexts named and their responsibilities written down
- [ ] `event-storm.md` created in the project directory
- [ ] All participants agree the timeline is complete (no "what about X?" surprises)

## Files involved

| File | Action |
|------|--------|
| `event-storm.md` | Create: living domain knowledge document |
| `BOUNDED_CONTEXTS.md` | Create (optional): context map for large projects |

## Common mistakes

**Skipping straight to data modeling** — "I'll just create the tables and we can figure out the domain later" produces a system organized around storage, not around business behavior. Event Storming takes 2–4 hours and prevents weeks of rework.

**Writing nouns instead of events** — "Order", "Payment", "User" are nouns, not events. Events are things that happened: "OrderPlaced", "PaymentProcessed", "UserRegistered". The difference matters — nouns describe things, events describe when state changes.

**Too few participants** — the value of Event Storming is the shared understanding between people who know the business and people who build the system. Running it alone as a design document misses the "storming" part. Include at least one domain expert (product owner, ops person, customer support) alongside the technical team.

**Leaving hotspots unresolved** — every red sticky is a design decision you'll have to make eventually. Better to make it explicitly now with stakeholders in the room than implicitly in code at 2 AM.

**Treating the output as final** — the event storm is a starting point, not a contract. Revisit it as you learn more. Add new events when you discover them. The `event-storm.md` should be a living document.
