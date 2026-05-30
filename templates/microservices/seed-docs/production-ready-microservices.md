# Production-Ready Microservices — Reference Guide

Based on the production readiness standards from Susan Fowler's "Production-Ready Microservices." Every service in your system should meet these standards before shipping to production.

## The Eight Production Readiness Standards

### 1. Stability

A production-ready service is stable and reliable. It handles failure gracefully and doesn't cascade failures to other services.

**Requirements:**
- Health check endpoints (liveness + readiness probes)
- Graceful shutdown (drain connections, finish in-flight requests, then exit)
- Circuit breakers for outbound calls (prevent calling a failing dependency repeatedly)
- Retry with exponential backoff + jitter (don't thundering-herd a recovering service)
- Timeouts on every outbound call (never wait forever)
- Bulkheads / isolation (one slow dependency doesn't exhaust your thread pool)
- Graceful degradation (if a non-critical dependency fails, return partial results, not errors)

**Implementation pattern:**
```
# Health check endpoints
GET /health/live    → 200 if the process is running (liveness)
GET /health/ready   → 200 if the service can handle requests (readiness)
                      503 if DB is down, cache is cold, etc.
```

**Circuit breaker states:**
```
CLOSED  → requests pass through normally
OPEN    → requests fail immediately (don't call the failing service)
HALF-OPEN → allow one request through to test if the service recovered
```

### 2. Reliability

A production-ready service has reliable infrastructure. It runs on more than one instance, survives host failures, and recovers automatically.

**Requirements:**
- Multiple instances (minimum 2 in production, 3 for critical services)
- Spread across availability zones (survive AZ failure)
- Auto-scaling based on load (CPU, memory, request rate, queue depth)
- Zero-downtime deployments (rolling update, blue-green, or canary)
- Database replication (primary + read replicas, automated failover)
- Automated recovery (orchestrator restarts crashed containers)

**Terraform pattern:**
```hcl
# ECS service with multi-AZ
resource "aws_ecs_service" "api" {
  desired_count = 2
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent = 200

  network_configuration {
    subnets = var.private_subnet_ids  # spread across AZs
  }
}
```

### 3. Scalability

A production-ready service scales with demand. It doesn't have hard limits that surprise you at 2 AM.

**Requirements:**
- Stateless services (no local state — use external stores for sessions, cache, files)
- Horizontal scaling (add instances, not bigger instances)
- Connection pooling for databases (don't create a new connection per request)
- Rate limiting (protect yourself and your dependencies from overload)
- Async processing for long operations (queue + worker, not synchronous blocking)
- Caching strategy (what to cache, TTL, invalidation)

**Key principle:** if you can't add another instance and have it work immediately, the service isn't scalable. Common blockers: local file storage, in-memory sessions, hardcoded instance addresses.

### 4. Fault Tolerance and Catastrophe Preparedness

A production-ready service is prepared for things going wrong. It has been tested under failure conditions.

**Requirements:**
- Defined SLAs/SLOs (latency, availability, error rate targets)
- Load testing (know where the service breaks before production finds out)
- Chaos testing (what happens when a dependency dies? when the network partitions?)
- Backup and restore procedures (tested, not just documented)
- Disaster recovery plan (how do you recover from a regional outage?)
- Runbooks for common failure scenarios (on-call engineers need step-by-step guides)

**SLO example:**
```
Service: user-api
Availability: 99.9% (43 minutes downtime/month)
Latency p99: < 500ms
Error rate: < 0.1% of requests
```

### 5. Performance

A production-ready service meets its performance targets consistently, not just in benchmarks.

**Requirements:**
- Performance benchmarks (what's the baseline under normal load?)
- Capacity planning (how many requests can one instance handle? how many instances at peak?)
- Database query optimization (indexes, query plans, N+1 detection)
- Connection reuse (HTTP keep-alive, connection pooling, gRPC multiplexing)
- Payload optimization (compress responses, paginate lists, avoid over-fetching)
- Caching at the right layer (CDN, API gateway, application, database)

### 6. Monitoring

A production-ready service is observable. You can answer "what is happening right now?" and "what happened at 3 AM last Tuesday?" without reading code.

**Requirements — the three pillars:**

**Logs:** structured JSON, with correlation IDs (trace-id) linking logs across services. Log levels: ERROR (wake someone up), WARN (investigate soon), INFO (normal operations), DEBUG (troubleshooting only).

**Metrics:** request rate, error rate, latency (p50, p95, p99), saturation (CPU, memory, disk, connections). RED method: Rate, Errors, Duration. USE method: Utilization, Saturation, Errors.

**Traces:** distributed traces linking a request across all services it touches. Every inter-service call propagates the trace context (W3C Trace Context or B3 headers).

**Alerting rules:**
```
# Alert when error rate exceeds SLO
error_rate > 0.1% for 5 minutes → page on-call
latency_p99 > 500ms for 10 minutes → notify channel
instance_count < 2 → page on-call immediately
```

### 7. Documentation

A production-ready service is documented well enough that an engineer who has never seen it can understand, deploy, and operate it.

**Requirements:**
- README with: what the service does, how to run it locally, how to deploy it
- API documentation (OpenAPI/Swagger for REST, protobuf definitions for gRPC)
- Architecture diagram showing dependencies (what it calls, what calls it)
- Runbooks for operational procedures (deploy, rollback, scale, failover)
- On-call guide (what to look at first when paged)
- Data flow documentation (what data enters, transforms, exits)

### 8. Organizational Readiness

A production-ready service has clear ownership, incident procedures, and review processes.

**Requirements:**
- Clear team ownership (who is responsible for this service?)
- On-call rotation (who gets paged at 3 AM?)
- Incident response process (detect → triage → mitigate → resolve → postmortem)
- Change management (review process for deployments, database migrations, config changes)
- Production readiness review (checklist reviewed before first production deployment)

## Service Decomposition

### Bounded Contexts

Each microservice owns one bounded context — a cohesive area of business logic with its own data and its own language. The boundaries come from your domain, not from technical convenience.

**Good boundaries:**
```
user-service     — authentication, profiles, preferences
billing-service  — subscriptions, invoices, payment processing
catalog-service  — product listings, search, categories
order-service    — cart, checkout, order lifecycle
```

**Bad boundaries:**
```
database-service     — just a DB wrapper (no domain logic)
utils-service        — shared utilities (not a bounded context)
frontend-service     — UI is not a microservice boundary
```

### Database Per Service

Each service owns its database. No service reads another service's tables directly. If service A needs data from service B, it calls service B's API.

```
user-service     → user_db     (users, profiles, auth_tokens)
billing-service  → billing_db  (subscriptions, invoices, payments)
catalog-service  → catalog_db  (products, categories, search_index)
order-service    → order_db    (orders, line_items, shipments)
```

This is non-negotiable. Shared databases create coupling — when one service changes its schema, every other service breaks.

## Inter-Service Communication

### Synchronous (Request-Response)

**REST:** simple, well-understood, good for CRUD operations. Use OpenAPI specs for contract definition.

**gRPC:** binary protocol over HTTP/2, better for high-throughput internal communication. Use protobuf for schema definition. Supports streaming.

**When to use sync:** the caller needs the response before continuing. User clicks "buy" → order-service calls billing-service synchronously because the user is waiting.

### Asynchronous (Event-Driven)

**Message queues** (RabbitMQ, SQS): point-to-point. One producer, one consumer. Good for task distribution.

**Event streams** (Kafka, Redis Streams): pub/sub with persistence. Multiple consumers can read the same events. Good for event sourcing and data integration.

**When to use async:** the caller doesn't need to wait. Order placed → publish "OrderCreated" event → billing-service processes it eventually. User doesn't wait for the invoice to be generated.

### The Anti-Pattern: Synchronous Chains

```
BAD: User → API Gateway → Service A → Service B → Service C → Service D
     (each call waits for the next, total latency = sum of all services)

BETTER: User → API Gateway → Service A (publishes event)
        Service B subscribes to event (processes independently)
        Service C subscribes to event (processes independently)
```

## Directory Structure for a Microservices Project

```
my-platform/
├── .workbench/project.json
├── CLAUDE.md
├── docker-compose.yml              ← local development (all services)
├── docker-compose.override.yml     ← local overrides (ports, volumes, debug)
│
├── services/
│   ├── user-service/
│   │   ├── src/
│   │   ├── Dockerfile
│   │   ├── package.json (or requirements.txt, Cargo.toml, go.mod)
│   │   └── README.md
│   ├── billing-service/
│   │   └── ...
│   └── catalog-service/
│       └── ...
│
├── proto/                           ← shared protobuf definitions (if using gRPC)
│   ├── user.proto
│   └── billing.proto
│
├── infra/
│   ├── terraform/
│   │   ├── modules/                 ← reusable modules (vpc, rds, ecs, etc.)
│   │   └── environments/
│   │       ├── dev/
│   │       ├── staging/
│   │       └── prod/
│   ├── k8s/                         ← Kubernetes manifests (if using K8s)
│   │   ├── base/                    ← Kustomize base
│   │   └── overlays/
│   │       ├── dev/
│   │       ├── staging/
│   │       └── prod/
│   └── swarm/                       ← Docker Swarm stacks (if using Swarm)
│       └── docker-stack.yml
│
├── ci/
│   ├── .github/workflows/          ← GitHub Actions
│   └── scripts/
│
└── docs/
    ├── architecture.md
    ├── api-contracts.md
    └── runbooks/
```

## Production Readiness Checklist

Use this before any service goes to production:

```
□ Stability
  □ Health check endpoints (liveness + readiness)
  □ Graceful shutdown implemented
  □ Circuit breakers on outbound calls
  □ Timeouts on all external calls
  □ Retry with backoff on transient failures

□ Reliability
  □ Minimum 2 instances in production
  □ Spread across availability zones
  □ Zero-downtime deployment configured
  □ Database has automated backups

□ Scalability
  □ Service is stateless
  □ Connection pooling configured
  □ Rate limiting in place
  □ Long operations are async (queued)

□ Fault Tolerance
  □ SLOs defined and measurable
  □ Load tested (know the breaking point)
  □ Backup/restore tested (not just documented)
  □ Runbook exists for common failures

□ Performance
  □ Baseline benchmarks recorded
  □ Database queries optimized (indexes, no N+1)
  □ Response compression enabled
  □ Caching strategy defined

□ Monitoring
  □ Structured logging with correlation IDs
  □ Metrics exported (RED: rate, errors, duration)
  □ Distributed tracing enabled
  □ Alerting rules configured with escalation

□ Documentation
  □ README: what, how to run, how to deploy
  □ API docs (OpenAPI or protobuf)
  □ Architecture diagram with dependencies
  □ On-call guide

□ Organizational
  □ Team ownership assigned
  □ On-call rotation in place
  □ Incident response process documented
```
