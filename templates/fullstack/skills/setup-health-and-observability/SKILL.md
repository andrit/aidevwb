---
name: setup-health-and-observability
description: Add /health/live and /health/ready endpoints, structured JSON logging with Pino, request ID tracing, and SIGTERM graceful shutdown — the minimum a production service needs to be operated safely
domain: fullstack
type: fullstack
triggers:
  - "health endpoint"
  - "health check"
  - "liveness"
  - "readiness"
  - "structured logging"
  - "graceful shutdown"
  - "SIGTERM"
  - "Pino"
  - "production observability"
  - "container health"
---

# Set Up Health and Observability

## When to use

Before deploying to any environment where a container orchestrator (Docker Compose healthcheck, Kubernetes, ECS) needs to know if the service is alive and ready. Also before shipping to any environment where logs need to be readable by a log aggregator (CloudWatch, Datadog, Elastic, Loki). Activate when the user asks "how do I add a health check", "the container keeps restarting", or "logs aren't showing up in my aggregator."

## Prerequisites

- Fastify application in `src/index.ts`
- Database connection available
- `pino` installed (Fastify includes it by default)

## Step 1 — Add Health Endpoints

Two distinct endpoints with different purposes:

```typescript
// src/routes/health.ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../services/db";

export async function registerHealthRoutes(
  app: FastifyInstance,
  db: Db
): Promise<void> {
  // Liveness: "Is the process alive?" — YES if the process can respond.
  // Orchestrators use this to decide whether to RESTART the container.
  // Never check external dependencies here — a broken DB should not restart the container.
  app.get("/health/live", async () => ({ status: "ok", uptime: process.uptime() }));

  // Readiness: "Is the service ready to receive traffic?" — NO if dependencies are unavailable.
  // Orchestrators use this to decide whether to ROUTE traffic to this instance.
  // Load balancers pull the instance from rotation while this returns non-200.
  app.get("/health/ready", async (req, reply) => {
    const checks: Record<string, "ok" | "fail"> = {};
    let healthy = true;

    // Database check
    try {
      await db.one("SELECT 1");
      checks.database = "ok";
    } catch {
      checks.database = "fail";
      healthy = false;
    }

    // Add other dependency checks here (Redis, external API, etc.)

    const status = healthy ? 200 : 503;
    return reply.code(status).send({
      status: healthy ? "ready" : "degraded",
      checks,
      uptime: process.uptime(),
    });
  });
}
```

```typescript
// src/index.ts — register health routes before other routes
import { registerHealthRoutes } from "./routes/health";

await registerHealthRoutes(app, db);
```

```yaml
# docker-compose.yml — use health endpoints in compose healthcheck
services:
  api:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/live"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

## Step 2 — Structured JSON Logging with Pino

Fastify uses Pino by default. Configure it so every log line is a JSON object readable by any log aggregator.

```typescript
// src/index.ts
import Fastify from "fastify";
import { config } from "./config";

const app = Fastify({
  logger: {
    level: config.logLevel,          // debug | info | warn | error
    // In production: output raw JSON (aggregator parses it)
    // In development: pretty-print for human readability
    transport: config.nodeEnv === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,

    // Redact sensitive fields — they are replaced with "[Redacted]"
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
    ],

    // Add service name to every log line — essential in a multi-service system
    base: {
      service: "api",
      version: process.env.npm_package_version ?? "unknown",
      env: config.nodeEnv,
    },

    // Serialize request and response — controls what appears in access logs
    serializers: {
      req(request) {
        return {
          method:    request.method,
          url:       request.url,
          requestId: request.id,  // see Step 3
        };
      },
      res(reply) {
        return { statusCode: reply.statusCode };
      },
    },
  },
});
```

**Logging patterns:**

```typescript
// Use structured fields, not string interpolation
// ✗ Wrong
req.log.info(`User ${userId} logged in from ${ip}`);

// ✓ Right — fields are queryable in log aggregators
req.log.info({ userId, ip, event: "user.login" }, "User logged in");

// Error logging
try {
  await doSomething();
} catch (err) {
  req.log.error({ err, userId, operation: "doSomething" }, "Operation failed");
  // Pino serializes Error objects — stack trace included automatically
}
```

## Step 3 — Request ID Tracing

Every request gets a unique ID that propagates through all log lines for that request.

```typescript
// src/index.ts — configure request ID generation and propagation
import { randomUUID } from "crypto";

const app = Fastify({
  // Generate a UUID for every request
  genReqId: () => randomUUID(),

  // Read an incoming request ID from a header (useful for distributed tracing)
  requestIdHeader: "x-request-id",
  requestIdLogLabel: "requestId",
  logger: { /* ... as above */ },
});

// Add request ID to every response so clients can correlate
app.addHook("onSend", async (req, reply) => {
  reply.header("x-request-id", req.id);
});

// In route handlers, the request ID is automatically included in all req.log calls
app.get("/users/:id", async (req) => {
  req.log.info({ userId: req.params.id }, "Fetching user");
  // Log output: { requestId: "abc-123", userId: "...", msg: "Fetching user" }
  return getUser(db, req.params.id);
});
```

## Step 4 — Graceful Shutdown on SIGTERM

Container orchestrators send `SIGTERM` when stopping a container. Without a handler, the process is killed immediately — mid-request, mid-DB-write, mid-tool-call.

```typescript
// src/index.ts
const app = Fastify({ /* ... */ });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutdown signal received");

  // 1. Stop accepting new requests
  await app.close();
  // Fastify's close() waits for all in-flight requests to complete (up to closeGracePeriod)

  // 2. Close DB connections
  await db.end();

  // 3. Exit cleanly
  app.log.info("Graceful shutdown complete");
  process.exit(0);
}

// SIGTERM: sent by Docker/Kubernetes when stopping a container
process.on("SIGTERM", () => shutdown("SIGTERM"));

// SIGINT: sent when Ctrl+C is pressed in development
process.on("SIGINT", () => shutdown("SIGINT"));

// Unhandled exceptions: log before crashing (don't swallow them)
process.on("uncaughtException", (err) => {
  app.log.fatal({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  app.log.fatal({ reason }, "Unhandled promise rejection — shutting down");
  process.exit(1);
});
```

```typescript
// Configure Fastify's close grace period
const app = Fastify({
  // Give in-flight requests up to 10s to complete before forcing close
  closeGracePeriod: 10_000,
  logger: { /* ... */ },
});
```

## Step 5 — Startup Validation Log

Log a structured startup summary so operators know the service started correctly:

```typescript
// src/index.ts
app.listen({ port: config.port, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.fatal({ err }, "Server failed to start");
    process.exit(1);
  }

  app.log.info({
    port:    config.port,
    env:     config.nodeEnv,
    pid:     process.pid,
    node:    process.version,
    routes:  app.printRoutes({ commonPrefix: false }).split("\n").length,
  }, "Server started");
});
```

## Checklist

- [ ] `GET /health/live` returns 200 immediately (no external checks)
- [ ] `GET /health/ready` checks DB and returns 503 when unhealthy
- [ ] Docker Compose `healthcheck` configured using `/health/live`
- [ ] Pino logger configured with `level`, `redact`, `base` (service name), and serializers
- [ ] `pino-pretty` used in development; raw JSON in staging/production
- [ ] Every request log line includes `requestId`
- [ ] `x-request-id` response header set on every response
- [ ] `SIGTERM` handler: stops accepting requests → drains DB connections → exits 0
- [ ] `uncaughtException` and `unhandledRejection` handlers log before exiting 1
- [ ] Structured fields used in all log calls — no string interpolation with variable values

## Files involved

| File | Action |
|------|--------|
| `src/routes/health.ts` | Create: `/health/live` and `/health/ready` |
| `src/index.ts` | Update: structured Pino config, SIGTERM/SIGINT handlers, startup log |
| `docker-compose.yml` | Update: `healthcheck` stanza |
| `package.json` | Update: add `pino-pretty` as dev dependency |

## Common mistakes

**Checking external dependencies in liveness** — if `/health/live` calls the database and the DB is slow, the orchestrator thinks the process is broken and restarts it. Liveness is "is the process alive?" — nothing more. Put dependency checks in readiness.

**Not binding to `0.0.0.0`** — `app.listen({ port: 3000 })` defaults to `127.0.0.1`, which is unreachable from outside the container. Always specify `host: "0.0.0.0"` in production.

**Not handling `SIGTERM` in long-running background tasks** — the outbox relay, event consumer, and stream processor also need to handle `SIGTERM`. Use a shared `isShuttingDown` flag and check it in each loop's condition.
