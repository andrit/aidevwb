---
name: add-new-service
description: Scaffold a new microservice inside an existing multi-service project — directory layout, Dockerfile, health endpoints, migrations, service registration, and test harness
domain: microservices
type: microservices
triggers:
  - "add a new service"
  - "new microservice"
  - "scaffold service"
  - "create service"
  - "add a service to the system"
  - "new bounded context"
  - "split a monolith"
---

# Add a New Microservice

## When to use

When adding a bounded-context service to an existing multi-service project — either splitting logic from an existing service, or introducing a net-new capability. Activate when the user says "add a new service", "create a service for X", or "split the Y service into two."

See `seed-docs/production-ready-microservices.md` — Stability and Scalability standards.

## Prerequisites

- Existing multi-service project directory with at least one service already scaffolded
- Docker Compose file (`docker-compose.yml`) at the project root
- Shared infrastructure defined: Postgres, Redis (if used), reverse proxy or API gateway
- Decision made: what is the **bounded context** of this service? What data does it own?

## Steps

### 1. Define the bounded context before writing code

Answer these four questions before creating any files:

```
1. What is the service's single responsibility?
   e.g. "orders service — owns the lifecycle of a customer order"

2. What data does it own?
   e.g. "orders table, order_items table — no other service writes these"

3. What does it expose?
   e.g. "REST API: POST /orders, GET /orders/:id, PATCH /orders/:id/status"

4. What does it depend on?
   e.g. "reads from users service (sync HTTP), publishes to events bus (async)"
```

Document this in `services/<name>/README.md` before building — it's the boundary contract.

### 2. Create the service directory layout

```bash
mkdir -p services/<name>/{src,migrations,tests,scripts}
```

Standard layout for a Node/TypeScript service:

```
services/<name>/
├── src/
│   ├── index.ts          — Fastify startup, health endpoints, graceful shutdown
│   ├── config.ts         — typed env var config (never hardcoded values)
│   ├── routes/           — HTTP handlers (one file per domain object)
│   ├── services/         — business logic (receives db as param)
│   ├── schemas/          — Zod schemas (source of truth for types)
│   └── lib/              — pure functions (no I/O)
├── migrations/
│   └── 001_initial.sql   — first migration (tables this service owns)
├── tests/
│   └── integration/      — tests that run against a real DB
├── Dockerfile
├── package.json
├── tsconfig.json
└── README.md             — bounded context contract
```

For Python services, replace `src/` with the standard Python layout:

```
services/<name>/
├── app/
│   ├── main.py           — FastAPI startup, health endpoints
│   ├── config.py         — pydantic Settings (env vars)
│   ├── routes/
│   ├── services/
│   └── models/
├── migrations/
├── tests/
├── Dockerfile
├── requirements.txt
└── README.md
```

### 3. Implement health endpoints first

Every service must have liveness and readiness probes before any business logic. These are what the orchestrator uses to decide whether to route traffic to this instance.

```typescript
// src/index.ts
import Fastify from "fastify";
import { getDb } from "./services/db.js";

const app = Fastify({ logger: true });

// Liveness: is the process running?
app.get("/health/live", async () => ({ status: "ok" }));

// Readiness: can the service handle traffic? (checks dependencies)
app.get("/health/ready", async (req, reply) => {
  try {
    const db = getDb();
    await db.query("SELECT 1");
    return { status: "ok", db: "connected" };
  } catch (err) {
    reply.code(503);
    return { status: "unavailable", db: "disconnected" };
  }
});

// Graceful shutdown — finish in-flight requests, then exit
const shutdown = async (signal: string) => {
  app.log.info({ signal }, "received shutdown signal");
  await app.close();   // drains connections, closes keep-alive sockets
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

const start = async () => {
  await runMigrations();
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
};
start();
```

### 4. Write the config module

All configuration from environment variables — no hardcoded URLs, ports, or credentials:

```typescript
// src/config.ts
import { z } from "zod";

const ConfigSchema = z.object({
  PORT:              z.coerce.number().default(3000),
  DATABASE_URL:      z.string().url(),
  SERVICE_NAME:      z.string().default("<name>-service"),
  LOG_LEVEL:         z.enum(["trace","debug","info","warn","error"]).default("info"),
  // Add service-specific config here
  ORDERS_API_URL:    z.string().url().optional(),  // downstream dependencies
});

export const config = ConfigSchema.parse(process.env);
export type Config = z.infer<typeof ConfigSchema>;
```

### 5. Write the first migration

```sql
-- migrations/001_initial.sql
-- <name>: core tables this service owns

CREATE TABLE IF NOT EXISTS <name>s (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  -- add service-specific columns here
);

CREATE INDEX IF NOT EXISTS idx_<name>s_created_at ON <name>s (created_at DESC);

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER <name>s_updated_at
  BEFORE UPDATE ON <name>s
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 6. Create the Dockerfile

```dockerfile
# Dockerfile — multi-stage build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/migrations ./migrations
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/health/live || exit 1
CMD ["node", "dist/index.js"]
```

### 7. Register the service in docker-compose.yml

```yaml
# docker-compose.yml — add to services:
  <name>-service:
    build:
      context: ./services/<name>
      dockerfile: Dockerfile
    environment:
      PORT: "3000"
      DATABASE_URL: "postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/<name>"
      SERVICE_NAME: "<name>-service"
      LOG_LEVEL: "info"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health/live"]
      interval: 15s
      timeout: 3s
      retries: 3
    networks:
      - internal
    restart: unless-stopped
```

Create the service's database (add to the DB init script or run once):

```sql
CREATE DATABASE <name>;
```

### 8. Write the first integration test

```typescript
// tests/integration/<name>.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/index.js";

describe("<name>-service integration", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("liveness probe returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("readiness probe checks DB connection", async () => {
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    // 200 if DB is up, 503 if not — both are valid test outcomes depending on env
    expect([200, 503]).toContain(res.statusCode);
  });
});
```

## Templates

### Minimal service scaffold (copy-paste)

```
services/<name>/
├── src/
│   ├── index.ts    (health endpoints + graceful shutdown)
│   ├── config.ts   (Zod-validated env vars)
│   ├── routes/
│   ├── services/
│   └── schemas/
├── migrations/
│   └── 001_initial.sql
├── tests/
├── Dockerfile
├── package.json
└── README.md       (bounded context contract)
```

### Bounded context README template

```markdown
# <Name> Service

## Responsibility
<One sentence: what this service does and why it exists.>

## Data Ownership
Tables this service owns (no other service writes these):
- `<name>s` — <description>

## API Contract
- `POST /<name>s` — create
- `GET /<name>s/:id` — read
- `PATCH /<name>s/:id` — update (partial)

## Dependencies
- **Sync (HTTP)**: <upstream service> — <what data it reads>
- **Async (events)**: publishes `<name>.created`, `<name>.updated` to event bus

## Owned Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (this service's own DB)
- `<UPSTREAM>_URL` — base URL for upstream service
```

## Checklist

- [ ] Bounded context documented in `services/<name>/README.md` before any code written
- [ ] Service owns specific tables — no other service writes to them
- [ ] `GET /health/live` returns 200 when process is running
- [ ] `GET /health/ready` returns 503 when DB is unavailable, 200 when ready
- [ ] `SIGTERM` handler drains connections and calls `app.close()` before `process.exit(0)`
- [ ] All config from environment variables — no hardcoded URLs or credentials
- [ ] `config.ts` uses Zod and throws at startup if required vars are missing
- [ ] Dockerfile uses multi-stage build; runs as non-root user
- [ ] `docker-compose.yml` registers the service with `depends_on` and `healthcheck`
- [ ] First migration creates only tables this service owns
- [ ] Integration test verifies health endpoints

## Files involved

| File | Action |
|------|--------|
| `services/<name>/src/index.ts` | Create: Fastify startup, health endpoints, graceful shutdown |
| `services/<name>/src/config.ts` | Create: Zod-validated env vars |
| `services/<name>/migrations/001_initial.sql` | Create: owned tables |
| `services/<name>/Dockerfile` | Create: multi-stage build, non-root user |
| `services/<name>/README.md` | Create: bounded context contract |
| `docker-compose.yml` | Add service entry with healthcheck and depends_on |

## Common mistakes

**No bounded context definition** — services that "share" tables create an invisible coupling. If two services both write the `users` table, you don't have microservices — you have a distributed monolith. Define ownership before writing code.

**Liveness and readiness conflated** — liveness (`/health/live`) just checks if the process is running. Readiness (`/health/ready`) checks if it can serve traffic. Kubernetes restarts the pod on liveness failure; it stops routing traffic on readiness failure. Using the same endpoint for both means you restart a pod that just has a slow DB connection instead of pulling it from rotation.

**No SIGTERM handler** — containers running in Kubernetes or Compose get SIGTERM before SIGKILL. Without a handler, in-flight requests are cut off mid-response. The handler needs to call `app.close()` which drains keep-alive connections.

**Hardcoded service URLs** — `http://users-service:3000` hardcoded in TypeScript means the service can't run in staging (where it might be `http://users-service-staging:3000`). Put every URL in config.

**Database created but not migrated** — the `depends_on: postgres` only waits for Postgres to accept connections, not for the database to exist. Make `index.ts` call `runMigrations()` on startup so the first request doesn't fail because the tables don't exist yet.
