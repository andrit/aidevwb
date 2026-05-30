---
name: production-readiness-review
description: Run the Susan Fowler production readiness checklist against a microservice — stability, reliability, scalability, fault tolerance, performance, monitoring, documentation — and produce a signed-off readiness report
domain: microservices
type: microservices
triggers:
  - "production readiness"
  - "production readiness review"
  - "is this service ready to ship"
  - "readiness checklist"
  - "Susan Fowler checklist"
  - "pre-launch review"
  - "ready for production"
  - "launch checklist"
  - "service review"
---

# Production Readiness Review

## When to use

Before promoting a microservice from staging to production, or when a service has been running in production but has never been formally reviewed. Activate when the user says "is this service ready to ship?", "run the production readiness checklist", or "we're about to go live."

See `seed-docs/production-ready-microservices.md` — Susan Fowler's eight standards.

## Prerequisites

- Service has been running in staging against real traffic (or load tests)
- `add-service-observability` skill applied (can't review what you can't see)
- Architecture diagram exists or can be sketched during the review
- Service owner present to answer questions about design decisions

## The Eight Standards (Fowler)

Run through each standard. Mark each item ✅ (done), ⚠️ (partial), or ❌ (missing). A service is not ready for production until every ❌ is resolved and all ⚠️ items are understood and accepted.

---

### Standard 1: Stability

| Check | Status | Notes |
|-------|--------|-------|
| `GET /health/live` returns 200 | | |
| `GET /health/ready` returns 503 when DB unavailable | | |
| Liveness and readiness are separate endpoints | | |
| SIGTERM handler drains connections before exit | | |
| In-flight requests complete during graceful shutdown | | |
| Circuit breakers on all outbound HTTP calls | | |
| Retry with exponential backoff + jitter on transient failures | | |
| No retries on 4xx responses | | |
| Timeout on every outbound call (no infinite waits) | | |
| Graceful degradation: non-critical dependency failure returns partial result | | |

**Verification commands:**

```bash
# Test graceful shutdown — send SIGTERM, check in-flight requests complete
docker kill --signal=SIGTERM <container>
# Watch logs for "received shutdown signal" and "server closed" before exit

# Test readiness probe — stop Postgres and verify 503
docker compose stop postgres
curl http://localhost:<port>/health/ready
# Expect: {"status":"unavailable","db":"disconnected"}

# Test circuit breaker — point service at a non-existent upstream
# Verify it returns a circuit-open error after threshold failures
```

---

### Standard 2: Reliability

| Check | Status | Notes |
|-------|--------|-------|
| Minimum 2 instances in production config | | |
| Spread across availability zones (if cloud) | | |
| Auto-scaling policy defined (CPU/memory thresholds) | | |
| Zero-downtime deployment configured (rolling update) | | |
| Database has read replica or backup strategy | | |
| Orchestrator restart policy set (`restart: unless-stopped`) | | |

**Verification:**

```bash
# Rolling update test — verify no dropped requests during deploy
docker compose up -d --no-deps <service>
# OR in Kubernetes:
kubectl rollout status deployment/<service>
```

---

### Standard 3: Scalability

| Check | Status | Notes |
|-------|--------|-------|
| Service is stateless (no local file storage, no in-memory session) | | |
| Adding a second instance works immediately (test it) | | |
| Database connection pool configured (not one connection per request) | | |
| Long operations are async (queue + worker, not synchronous) | | |
| Caching strategy documented (what's cached, TTL, invalidation) | | |
| Rate limits on inbound API protect the service from overload | | |

**Verification:**

```bash
# Scale to 2 instances and run load test
docker compose up -d --scale <service>=2
npx autocannon -c 50 -d 10 http://localhost:<port>/<endpoint>
# Both instances should handle traffic; no state loss
```

---

### Standard 4: Fault Tolerance

| Check | Status | Notes |
|-------|--------|-------|
| SLO defined: latency (p95, p99) and error rate targets | | |
| Runbook exists for the top 3 failure scenarios | | |
| Chaos test: what happens when the DB goes down? | | |
| Chaos test: what happens when upstream service is unavailable? | | |
| Dead letter queue (or retry table) for failed async events | | |
| On-call rotation or alerting owner defined | | |

**Verification:**

```bash
# Chaos: DB unavailable
docker compose stop postgres
# Service should return 503 on /health/ready
# Routes that need DB should return 503 or degrade gracefully
# Non-DB routes should still work

# Chaos: upstream unavailable
# Disable upstream service; verify circuit breaker opens; verify error response is useful
```

---

### Standard 5: Performance

| Check | Status | Notes |
|-------|--------|-------|
| Latency baseline established (p50/p95/p99 from load test) | | |
| No N+1 query patterns (checked with slow query log) | | |
| DB indexes exist on all WHERE/JOIN columns used in queries | | |
| Connection pool size appropriate for concurrency level | | |
| Load test run at 2× expected peak traffic without degradation | | |
| Memory leak test: run for 30 min under load, memory stable? | | |

**Verification:**

```bash
# Load test
npx autocannon -c 100 -d 30 http://localhost:<port>/<critical-endpoint>
# Look at: req/s, latency p99, errors

# Slow query log (Postgres)
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

---

### Standard 6: Monitoring

| Check | Status | Notes |
|-------|--------|-------|
| All logs are structured JSON (no console.log) | | |
| Logs include request_id, service_name, event name | | |
| Distributed traces visible in Tempo (cross-service request) | | |
| `/metrics` endpoint returns Prometheus-format metrics | | |
| At least one business metric (domain-specific counter/histogram) | | |
| Grafana dashboard with: request rate, error rate, latency | | |
| Alert rule for error rate > 1% over 5 minutes | | |
| Alert rule for p99 latency > SLO threshold | | |

**Verification:**

```bash
# Verify structured logs
docker compose logs <service> | head -5
# Each line should be valid JSON with event, level, service fields

# Check /metrics
curl http://localhost:<port>/metrics | grep http_requests_total
```

---

### Standard 7: Documentation

| Check | Status | Notes |
|-------|--------|-------|
| `README.md` describes bounded context (owner, responsibility, API) | | |
| OpenAPI spec or code-generated API docs available | | |
| Runbook: how to restart the service | | |
| Runbook: how to roll back a deployment | | |
| Runbook: top 3 alert scenarios and resolution steps | | |
| Environment variable reference (all vars, required/optional, defaults) | | |
| Architecture diagram showing upstream/downstream dependencies | | |

---

### Standard 8: Infrastructure

| Check | Status | Notes |
|-------|--------|-------|
| Dockerfile follows multi-stage build | | |
| Container runs as non-root user | | |
| All secrets from environment variables (no `.env` in production) | | |
| Secrets stored in a secrets manager (AWS SSM, Doppler, Vault) | | |
| Terraform module exists for this service (see `add-terraform-module`) | | |
| CI/CD pipeline runs tests before deploy | | |
| Staging environment mirrors production config (not workbench config) | | |

---

## Readiness Report Template

After completing the checklist, produce a sign-off document:

```markdown
# Production Readiness Report: <Service Name>

**Date:** <date>
**Reviewer:** <name>
**Service version:** <version>

## Summary

| Standard | Status | Blockers |
|----------|--------|----------|
| 1. Stability | ✅/⚠️/❌ | |
| 2. Reliability | | |
| 3. Scalability | | |
| 4. Fault Tolerance | | |
| 5. Performance | | |
| 6. Monitoring | | |
| 7. Documentation | | |
| 8. Infrastructure | | |

## Blockers (must fix before launch)
1. <item>

## Accepted risks (known ⚠️ items and why they're acceptable)
1. <item> — <reason it's accepted>

## Sign-off
- [ ] Service owner
- [ ] Platform/infra reviewer
- [ ] Security reviewer (if service handles PII or payments)
```

Save this as `services/<name>/PRODUCTION-READINESS.md`.

## Common Failure Patterns

**"We'll add monitoring later"** — observability is not a post-launch concern. An unmonitored service in production is a liability. If you can't see it, you can't diagnose it when it fails at 2 AM.

**Staging uses workbench URLs** — staging `docker-compose.yml` that references `http://mcp-server:3100` or `http://otel-collector:4318` with workbench hostnames will fail in production. Staging must use the same infrastructure config as production.

**Single instance in production** — any service running as a single instance has zero-downtime deployment impossible. Deployments cause brief outages. Minimum 2 instances.

**No runbook for alerts** — an alert fires and no one knows what to do because the person who knows is on vacation and there's no runbook. Before launch, write down what to do when each alert fires.

**"Tests pass" is not readiness** — tests verify code behavior. Production readiness verifies operational behavior: startup time, graceful shutdown, memory stability under load, behavior when dependencies fail.

## Checklist

- [ ] All 8 standards reviewed; every item has a status
- [ ] All ❌ items assigned to a person with a due date
- [ ] All ⚠️ items documented with acceptance rationale
- [ ] Load test run at 2× expected peak; results documented
- [ ] Chaos tests run: DB down, upstream down
- [ ] Runbook written for top 3 failure scenarios
- [ ] `PRODUCTION-READINESS.md` saved and signed off
- [ ] Staging environment validated against production config (not workbench config)

## Files involved

| File | Action |
|------|--------|
| `services/<name>/PRODUCTION-READINESS.md` | Create: signed-off readiness report |
| `services/<name>/docs/runbook.md` | Create: operational runbook |
