---
name: add-service-observability
description: Add structured JSON logging, OTel distributed tracing, Prometheus metrics, and health/readiness probes to a microservice — so every request is traceable across service boundaries
domain: microservices
type: microservices
triggers:
  - "add observability"
  - "add logging"
  - "add tracing"
  - "add metrics"
  - "distributed tracing"
  - "correlate logs across services"
  - "trace requests across services"
  - "service is a black box"
  - "why is my service slow"
  - "add health checks"
---

# Add Service Observability

## When to use

When a service needs production-grade visibility: structured logs that aggregate into a log platform, distributed traces that follow a request across multiple services, metrics that feed Grafana dashboards, and health endpoints that container orchestrators use. Activate when the user says "I can't tell what's happening inside the service", "add tracing", or "why is service X slow."

See `seed-docs/production-ready-microservices.md` — Performance and Scalability standards.

## Prerequisites

- Service scaffolded (see `add-new-service` skill)
- OTel collector running (workbench provides this; production needs a sidecar or hosted collector)
- Grafana + Tempo running for trace visualization (workbench provides)
- `@opentelemetry/sdk-node`, `pino`, `prom-client` available

## Steps

### 1. Install observability packages

```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  pino pino-http prom-client uuid
```

### 2. Initialize OTel tracing before anything else

OTel must initialize before importing Fastify or database clients — it patches their modules at startup. Create a separate `tracing.ts` and import it as the first line of `index.ts`.

```typescript
// src/tracing.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]:    process.env.SERVICE_NAME ?? "unknown-service",
    [SEMRESATTRS_SERVICE_VERSION]: process.env.SERVICE_VERSION ?? "0.0.0",
  }),
  traceExporter: new OTLPTraceExporter({
    url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://otel-collector:4318"}/v1/traces`,
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://otel-collector:4318"}/v1/metrics`,
    }),
    exportIntervalMillis: 15_000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-http": { enabled: true },
      "@opentelemetry/instrumentation-pg": { enabled: true },
      "@opentelemetry/instrumentation-redis": { enabled: true },
    }),
  ],
});

sdk.start();

process.on("SIGTERM", async () => {
  await sdk.shutdown();
});
```

```typescript
// src/index.ts — FIRST LINE must be tracing import
import "./tracing.js";
import Fastify from "fastify";
// ... rest of imports
```

### 3. Add structured JSON logging with Pino

Replace `console.log` entirely — structured logs are parseable by log aggregators (Loki, CloudWatch, Datadog):

```typescript
// src/index.ts
import Fastify from "fastify";
import pino from "pino";
import { pinoHttp } from "pino-http";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Production: JSON output; development: pretty-print
  transport: process.env.NODE_ENV === "development"
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
  // Redact sensitive fields from logs
  redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"],
  base: {
    service: process.env.SERVICE_NAME ?? "unknown",
    version: process.env.SERVICE_VERSION ?? "0.0.0",
  },
});

const app = Fastify({ loggerInstance: logger });

// Auto-log every request/response with timing
app.addHook("onRequest", pinoHttp({ logger }));
```

**Use the structured logger everywhere — never console.log:**

```typescript
// In route handlers and services:
req.log.info({ order_id: id, customer_id }, "order retrieved");
req.log.error({ err, order_id: id }, "failed to fetch order");

// Outside request context:
logger.info({ event: "migration_complete", count: migrations.length }, "migrations applied");
logger.error({ err }, "startup failed");
```

### 4. Add a custom span for business-critical operations

Auto-instrumentation traces HTTP and DB automatically. Add manual spans for operations that span multiple steps or that you need to diagnose:

```typescript
// src/lib/tracing.ts — span helper
import { trace, context, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer(process.env.SERVICE_NAME ?? "service");

export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attrs);
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}
```

Use it around business operations:

```typescript
// In a route handler:
const order = await withSpan("order.create", { "customer.id": customerId }, async () => {
  const validated = await validateInventory(items);
  const order = await db.createOrder(customerId, validated);
  await publisher.publish("order.created", order);
  return order;
});
```

### 5. Propagate trace context across service calls

When making HTTP calls to other services, propagate the trace context header so traces span multiple services in Tempo:

```typescript
// src/lib/fetch-with-trace.ts
import { propagation, context } from "@opentelemetry/api";

export async function fetchWithTrace(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);

  // Inject W3C traceparent + tracestate headers
  propagation.inject(context.active(), headers, {
    set: (carrier, key, value) => (carrier as Headers).set(key, value),
  });

  return fetch(url, { ...options, headers });
}
```

On the receiving end, OTel auto-instrumentation extracts these headers automatically — no manual work needed if `getNodeAutoInstrumentations` is configured.

### 6. Expose Prometheus metrics

```typescript
// src/metrics.ts
import { Registry, Counter, Histogram } from "prom-client";

export const registry = new Registry();

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["method", "route"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

// Business metrics (add domain-specific ones here)
export const ordersCreatedTotal = new Counter({
  name: "orders_created_total",
  help: "Total orders created",
  labelNames: ["status"],
  registers: [registry],
});
```

Wire into Fastify:

```typescript
// src/index.ts
import { registry, httpRequestsTotal, httpRequestDuration } from "./metrics.js";

// Record metrics per request
app.addHook("onResponse", (req, reply, done) => {
  httpRequestsTotal.inc({
    method: req.method,
    route: req.routerPath ?? req.url,
    status_code: reply.statusCode.toString(),
  });
  done();
});

// Prometheus scrape endpoint
app.get("/metrics", async (req, reply) => {
  reply.header("Content-Type", registry.contentType);
  return registry.metrics();
});
```

### 7. Enrich health/ready with dependency status

```typescript
app.get("/health/ready", async (req, reply) => {
  const checks: Record<string, "ok" | "error"> = {};
  let allOk = true;

  // Database check
  try {
    await db.query("SELECT 1");
    checks.database = "ok";
  } catch {
    checks.database = "error";
    allOk = false;
  }

  // Upstream service check (optional — only if this service can't work without it)
  try {
    const res = await fetch(`${config.USERS_API_URL}/health/live`,
      { signal: AbortSignal.timeout(2000) });
    checks.users_service = res.ok ? "ok" : "error";
    if (!res.ok) allOk = false;
  } catch {
    checks.users_service = "error";
    allOk = false;
  }

  reply.code(allOk ? 200 : 503);
  return { status: allOk ? "ok" : "degraded", checks };
});
```

### 8. Configure OTel collector in docker-compose.yml

```yaml
# docker-compose.yml — add to the service's env vars
  <name>-service:
    environment:
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4318"
      OTEL_SERVICE_NAME: "<name>-service"
      SERVICE_NAME: "<name>-service"
      SERVICE_VERSION: "1.0.0"
      LOG_LEVEL: "info"
```

## Templates

### Log field conventions

Always include these fields in log entries so they can be filtered and correlated:

```typescript
// Good — queryable by log aggregator
req.log.info({
  event: "order_created",
  order_id: order.id,
  customer_id: order.customerId,
  total_cents: order.totalCents,
  duration_ms: Date.now() - startTime,
}, "order created successfully");

// Bad — unstructured, unsearchable
console.log(`Order ${order.id} created for customer ${order.customerId}`);
```

### Span naming conventions

```
<service>.<entity>.<action>
  order-service.order.create
  order-service.inventory.validate
  order-service.event.publish
```

## Checklist

- [ ] `src/tracing.ts` imported as the first line of `src/index.ts`
- [ ] OTel SDK initialized with `SERVICE_NAME` and `SERVICE_VERSION` from env vars
- [ ] Auto-instrumentation enabled for HTTP, Postgres, Redis
- [ ] All `console.log`/`console.error` removed — replaced with `req.log` or `logger`
- [ ] Pino configured with field redaction for `authorization`, `cookie`, `password`, `token`
- [ ] `withSpan()` wrapping multi-step business operations
- [ ] Outbound HTTP calls use `fetchWithTrace()` to propagate `traceparent`
- [ ] `/metrics` endpoint exposed (Prometheus format)
- [ ] Business-specific counters/histograms defined in `src/metrics.ts`
- [ ] `/health/ready` includes dependency check status
- [ ] `OTEL_EXPORTER_OTLP_ENDPOINT` in docker-compose env vars (not hardcoded)
- [ ] Trace visible end-to-end in Tempo when request crosses service boundary

## Files involved

| File | Action |
|------|--------|
| `src/tracing.ts` | Create: OTel SDK init, auto-instrumentations |
| `src/index.ts` | Add tracing import first; wire Pino + metrics hooks |
| `src/lib/tracing.ts` | Create: `withSpan()` helper |
| `src/lib/fetch-with-trace.ts` | Create: trace-context-propagating fetch wrapper |
| `src/metrics.ts` | Create: Prometheus registry and metrics |
| `docker-compose.yml` | Add `OTEL_*` env vars to service |
| `package.json` | Add OTel, Pino, prom-client dependencies |

## Common mistakes

**OTel import not first** — if any other module is imported before `tracing.ts`, OTel can't instrument it. HTTP clients and database adapters initialized before OTel will not emit spans. The `import "./tracing.js"` must be the first line of `index.ts`.

**Using console.log** — `console.log` outputs plain text that log aggregators can't parse. Loki, Datadog, and CloudWatch all need JSON. One `console.log` in a hot path pollutes structured log streams.

**Not redacting sensitive fields** — authorization headers and tokens will appear in logs unless explicitly redacted with Pino's `redact` config. Check your log output before shipping.

**Checking upstream services in /health/ready** — if service A's readiness depends on service B's health, and service B depends on service C, you've created a chain where one service failure makes everything report unhealthy. Only check direct dependencies (your own DB, your own cache). Use degraded mode for optional upstreams.

**Hard-coding the OTel collector URL** — `http://otel-collector:4318` is the workbench hostname. In production it might be `http://otel-collector.monitoring.svc.cluster.local:4318` or an AWS-hosted endpoint. Always read from `OTEL_EXPORTER_OTLP_ENDPOINT`.

**No business metrics** — infrastructure metrics (request count, latency) are generated automatically. Business metrics (orders created, payments failed, items out of stock) are signals that generic infrastructure can't know about. Add at least one business counter per domain operation.
