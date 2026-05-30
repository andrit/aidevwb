---
name: setup-inter-service-comms
description: Wire up sync (REST/gRPC) and async (event bus) communication between services — client generation, retry logic, circuit breakers, distributed transaction patterns, and contract testing
domain: microservices
type: microservices
triggers:
  - "inter-service communication"
  - "service A calls service B"
  - "event bus"
  - "async messaging"
  - "service mesh"
  - "distributed transactions"
  - "services talk to each other"
  - "publish subscribe microservices"
  - "saga pattern"
  - "choreography"
---

# Setup Inter-Service Communication

## When to use

When a new service needs to call another service, or when adding async event-driven communication between services. Activate when the user says "service A needs data from service B", "publish an event when X happens", "implement the saga pattern", or "distributed transaction".

See `seed-docs/production-ready-microservices.md` — Fault Tolerance and Communication standards.

## Prerequisites

- At least two services scaffolded (see `add-new-service` skill)
- Decision made: **sync or async?** (see decision guide below)
- For async: event broker running in Docker Compose (Redis Streams or RabbitMQ)
- For gRPC: `.proto` definitions agreed between service teams

## Decision Guide: Sync vs Async

```
Use SYNC (REST/gRPC) when:
  - The caller needs an immediate response to proceed
  - The operation is a query (read-only lookup)
  - You need a confirmation before the user sees a result
  Example: "Get the user's profile to include in the order response"

Use ASYNC (events) when:
  - The operation is a side effect that can happen later
  - Multiple services need to react to the same event
  - The downstream service might be slow or unavailable
  - You want to decouple services so they can deploy independently
  Example: "Send a confirmation email after an order is created"

Never use sync calls in a loop — N calls to service B for N records
is a distributed N+1 problem. Batch or use async.
```

## Part A: Sync Communication (REST)

### 1. Create a typed service client

Don't scatter raw `fetch`/`httpx` calls throughout your service. One client module per upstream service:

```typescript
// src/clients/users-client.ts
import { z } from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
});

export type User = z.infer<typeof UserSchema>;

export class UsersClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string, timeout = 5000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  async getUser(id: string): Promise<User | null> {
    const res = await fetchWithRetry(`${this.baseUrl}/users/${id}`, {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (res.status === 404) return null;
    if (!res.ok) throw new UpstreamError("users", res.status, await res.text());

    const data = await res.json();
    return UserSchema.parse(data);   // validate the response shape
  }
}

export class UpstreamError extends Error {
  constructor(
    public service: string,
    public statusCode: number,
    public body: string,
  ) {
    super(`${service} returned ${statusCode}: ${body}`);
    this.name = "UpstreamError";
  }
}
```

### 2. Add retry with exponential backoff

Never retry unconditionally — only retry on transient failures (network, 429, 5xx). Never retry on 4xx (those are your bug, not the network's).

```typescript
// src/lib/fetch-with-retry.ts
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
  baseDelayMs = 200,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);

      // Don't retry client errors — they won't fix themselves
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return res;
      }

      // Retry on 429 and 5xx
      if (res.status === 429 || res.status >= 500) {
        if (attempt === maxRetries) return res;
        await sleep(baseDelayMs * 2 ** attempt + Math.random() * 100); // jitter
        continue;
      }

      return res;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        await sleep(baseDelayMs * 2 ** attempt + Math.random() * 100);
      }
    }
  }

  throw lastError ?? new Error(`fetch failed after ${maxRetries} retries: ${url}`);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
```

### 3. Add a circuit breaker for outbound calls

When a downstream service is failing, don't keep hammering it. Use a circuit breaker to fail fast and allow the downstream service to recover.

```typescript
// src/lib/circuit-breaker.ts
type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly name: string,
    private readonly failureThreshold = 5,
    private readonly recoveryTimeMs = 30_000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeMs) {
        this.state = "half-open";
      } else {
        throw new Error(`Circuit breaker OPEN for ${this.name} — fast failing`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    this.state = "closed";
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = "open";
    }
  }

  getState() { return this.state; }
}
```

Wire the circuit breaker into the client:

```typescript
// src/clients/users-client.ts
const breaker = new CircuitBreaker("users-service");

export class UsersClient {
  async getUser(id: string): Promise<User | null> {
    return breaker.execute(() => this._fetchUser(id));
  }

  private async _fetchUser(id: string) { /* ... */ }
}
```

## Part B: Async Communication (Event Bus)

### 4. Define event schemas before publishing

Events are an API — once published, downstream services depend on them. Define schemas before writing publisher or consumer code.

```typescript
// src/events/schemas.ts
import { z } from "zod";

// Every event has the same envelope
export const EventEnvelopeSchema = z.object({
  event_id:   z.string().uuid(),
  event_type: z.string(),
  source:     z.string(),          // which service published this
  timestamp:  z.string().datetime(),
  version:    z.number().int().default(1),
  payload:    z.record(z.unknown()),
});

// Domain-specific events
export const OrderCreatedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal("order.created"),
  payload: z.object({
    order_id:    z.string().uuid(),
    customer_id: z.string().uuid(),
    total_cents: z.number().int(),
    items:       z.array(z.object({ sku: z.string(), qty: z.number().int() })),
  }),
});

export type OrderCreated = z.infer<typeof OrderCreatedSchema>;
```

### 5. Implement publisher and consumer (Redis Streams)

Redis Streams provide durable, at-least-once delivery without an additional broker:

```typescript
// src/events/publisher.ts
import { createClient } from "redis";
import { v4 as uuid } from "uuid";

export class EventPublisher {
  constructor(private redis: ReturnType<typeof createClient>) {}

  async publish(eventType: string, payload: Record<string, unknown>): Promise<string> {
    const event = {
      event_id:   uuid(),
      event_type: eventType,
      source:     process.env.SERVICE_NAME ?? "unknown",
      timestamp:  new Date().toISOString(),
      version:    "1",
      payload:    JSON.stringify(payload),
    };

    // XADD to stream named after the event type
    const id = await this.redis.xAdd(`events:${eventType}`, "*", event);
    return id;
  }
}
```

```typescript
// src/events/consumer.ts
import { createClient } from "redis";

export class EventConsumer {
  private running = false;

  constructor(
    private redis: ReturnType<typeof createClient>,
    private groupName: string,
    private consumerName: string,
  ) {}

  async subscribe(
    eventType: string,
    handler: (payload: Record<string, unknown>) => Promise<void>,
  ) {
    const stream = `events:${eventType}`;

    // Create consumer group (idempotent)
    try {
      await this.redis.xGroupCreate(stream, this.groupName, "0", { MKSTREAM: true });
    } catch (e: any) {
      if (!e.message.includes("BUSYGROUP")) throw e;
    }

    this.running = true;
    while (this.running) {
      const messages = await this.redis.xReadGroup(
        this.groupName, this.consumerName,
        [{ key: stream, id: ">" }],
        { COUNT: 10, BLOCK: 2000 },
      );

      if (!messages) continue;

      for (const { messages: msgs } of messages) {
        for (const { id, message } of msgs) {
          try {
            const payload = JSON.parse(message.payload as string);
            await handler(payload);
            await this.redis.xAck(stream, this.groupName, id);
          } catch (err) {
            console.error({ event: "consumer_error", stream, id, err });
            // Don't ack — message will be redelivered after PEL timeout
          }
        }
      }
    }
  }

  stop() { this.running = false; }
}
```

### 6. Distributed transactions — the Saga pattern

When a business operation spans multiple services, use sagas (choreography or orchestration) instead of distributed 2PC.

**Choreography saga** (event-driven, no central coordinator):

```
Order Service                 Payment Service           Inventory Service
     |                              |                         |
     | -- order.created --------> [listen]               [listen]
     |                             |                          |
     |                   payment.succeeded --------->    [listen]
     |                   payment.failed --------->       (skip)
     |                             |                          |
     | <-- payment.succeeded -----                  inventory.reserved
     | <-- payment.failed --------                  inventory.failed
     |
   (update order status based on downstream events)
```

```typescript
// In order-service: react to payment events
consumer.subscribe("payment.succeeded", async (payload) => {
  await db.query(
    "UPDATE orders SET status = 'confirmed' WHERE id = $1",
    [payload.order_id]
  );
  await publisher.publish("order.confirmed", { order_id: payload.order_id });
});

consumer.subscribe("payment.failed", async (payload) => {
  await db.query(
    "UPDATE orders SET status = 'payment_failed' WHERE id = $1",
    [payload.order_id]
  );
  // Publish compensating event
  await publisher.publish("order.cancelled", {
    order_id: payload.order_id,
    reason: "payment_failed",
  });
});
```

**Compensation rule**: every step that can succeed must have a compensating event that undoes it if a later step fails. Define compensating events before writing saga code.

### 7. Contract testing

When service A depends on service B's API, add a contract test to catch breaking changes before they reach staging:

```typescript
// tests/contracts/users-service.contract.test.ts
// Runs against a real users-service instance (docker compose up users-service)

describe("Users Service contract", () => {
  const client = new UsersClient(process.env.USERS_API_URL!);

  it("GET /users/:id returns expected shape", async () => {
    const user = await client.getUser(TEST_USER_ID);
    // Shape validation — Zod parse will throw if service breaks the contract
    expect(UserSchema.safeParse(user).success).toBe(true);
  });

  it("GET /users/:id returns null for unknown id", async () => {
    const user = await client.getUser("00000000-0000-0000-0000-000000000000");
    expect(user).toBeNull();
  });
});
```

## Templates

### Sync client checklist (per upstream service)

```
src/clients/<service>-client.ts
  ├── Typed response schema (Zod)
  ├── Single exported class with one method per endpoint
  ├── AbortSignal.timeout() on every fetch
  ├── fetchWithRetry() wrapper (no bare fetch)
  ├── CircuitBreaker wrapping every call
  └── UpstreamError class for non-2xx responses
```

### Async event checklist (per event type)

```
src/events/schemas.ts
  └── EventEnvelopeSchema + domain-specific schema (Zod)
src/events/publisher.ts
  └── EventPublisher.publish(type, payload) → Redis XADD
src/events/consumer.ts
  └── EventConsumer.subscribe(type, handler) → consumer group loop
```

## Checklist

- [ ] Sync vs async decision documented before implementation
- [ ] Typed client module created for each upstream service (`src/clients/<service>-client.ts`)
- [ ] Every outbound HTTP call uses `fetchWithRetry` (no bare `fetch`)
- [ ] `AbortSignal.timeout()` set on every outbound call (no infinite waits)
- [ ] `CircuitBreaker` wraps every sync client call
- [ ] Event schemas defined in `src/events/schemas.ts` before publisher/consumer written
- [ ] Events published to `events:<event_type>` Redis Stream
- [ ] Consumer uses consumer groups (at-least-once delivery, not fire-and-forget)
- [ ] Failed consumer events are not acked (redelivered after PEL timeout)
- [ ] Saga compensation events defined for every step that can succeed
- [ ] Contract test covers response shape for every upstream endpoint consumed
- [ ] Circuit breaker state exposed in `/health/ready` response

## Files involved

| File | Action |
|------|--------|
| `src/clients/<service>-client.ts` | Create: typed client with retry + circuit breaker |
| `src/lib/fetch-with-retry.ts` | Create: shared retry wrapper |
| `src/lib/circuit-breaker.ts` | Create: shared circuit breaker class |
| `src/events/schemas.ts` | Create: event envelope + domain event Zod schemas |
| `src/events/publisher.ts` | Create: Redis Stream publisher |
| `src/events/consumer.ts` | Create: Redis Stream consumer group loop |
| `tests/contracts/<service>.contract.test.ts` | Create: response shape contract tests |

## Common mistakes

**Sync call in a loop** — `for (const id of ids) { await usersClient.getUser(id) }` is a distributed N+1. Use a batch endpoint or fetch IDs in parallel with `Promise.all`.

**No timeout on outbound calls** — one slow upstream service will hold your thread until Node.js's socket timeout (which is minutes, not seconds). Always set `AbortSignal.timeout(5000)`.

**Retrying 4xx responses** — a `400 Bad Request` or `404 Not Found` won't become a `200` no matter how many times you retry it. Only retry network errors, `429`, and `5xx`.

**Shared circuit breaker state** — if the circuit breaker is a module-level singleton, all instances of the service share its state. Use a per-service-instance breaker or a distributed state backend if running multiple replicas.

**Event without compensation** — publishing `order.created` without defining `order.cancelled` means any downstream failure that needs to roll back the order has no path to do so. Define compensating events upfront, even if they're never fired in the happy path.

**No schema validation on consumed events** — events from another service can have unexpected shapes (schema drift, bugs, format changes). Always parse consumed events through Zod before processing. Log and dead-letter events that fail parsing; don't crash the consumer.
