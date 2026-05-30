---
name: production-agent-deployment
description: Transition an agent from workbench development to standalone production — replace workbench API references, add structured logging, add a health endpoint, handle SIGTERM gracefully, and run a pre-launch smoke test
domain: agent
type: agent
triggers:
  - "deploy agent"
  - "production agent"
  - "agent to production"
  - "standalone agent"
  - "agent not workbench"
  - "export agent"
  - "agent smoke test"
  - "agent health"
---

# Production Agent Deployment

## When to use

When an agent built in the workbench needs to run in production without the workbench running alongside it. The workbench provides memory, RAG, and bus APIs during development — in production, the agent must either use the project's own exported API or explicitly not depend on those services. Activate when the user says "ship the agent", "deploy to production", or "agent works in workbench but not standalone."

## Prerequisites

- Agent working and eval-passing in the workbench (`write-agent-eval` skill complete)
- `make export-stack NAME=<project>` run to generate the standalone infrastructure
- Docker installed on the production host

## The Core Problem

Every agent scaffold contains this:

```python
WORKBENCH_API = os.environ.get("WORKBENCH_API", "http://localhost:3100")
```

In production, `http://localhost:3100` doesn't exist unless the workbench is running. The agent silently fails when calling `agent_remember`, `rag_query`, or `bus_publish`.

The fix is explicit and simple: the exported stack provides its own API, and the agent points to it.

## Step 1 — Replace Workbench URL References

```python
# agent/config.py — single place for all external URLs
import os

# In development: points to the workbench's mcp-server container
# In production: points to the project's own exported API container
WORKBENCH_API = os.environ["WORKBENCH_API"]  # no default — must be set explicitly

# Fail fast if not configured
if not WORKBENCH_API:
    raise RuntimeError(
        "WORKBENCH_API environment variable is required. "
        "Set it to the URL of the exported API (e.g., http://api:3000)."
    )

PROJECT = os.environ["WORKBENCH_PROJECT"]  # no default
```

```python
# agent/tools/memory.py — use config, not hardcoded URLs
from .config import WORKBENCH_API, PROJECT
import httpx

async def remember(key: str, value: str) -> None:
    async with httpx.AsyncClient() as client:
        await client.post(f"{WORKBENCH_API}/memory", json={
            "project": PROJECT, "key": key, "value": value
        }, timeout=10.0)

async def recall(key: str) -> str | None:
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{WORKBENCH_API}/memory/{PROJECT}/{key}", timeout=10.0)
        if r.status_code == 404:
            return None
        return r.json().get("value")
```

## Step 2 — Add Structured Logging

Replace `print()` with structured JSON logging. Log aggregators (CloudWatch, Datadog) can't index plain text.

```python
# agent/lib/logging.py
import logging
import json
import os
import sys
from datetime import datetime, timezone

class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level":     record.levelname.lower(),
            "service":   "agent",
            "message":   record.getMessage(),
            "logger":    record.name,
        }
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)
        # Include extra fields passed to the logger
        for key, value in record.__dict__.items():
            if key not in {"msg", "args", "exc_info", "exc_text", "stack_info",
                           "lineno", "funcName", "created", "msecs", "relativeCreated",
                           "thread", "threadName", "processName", "process",
                           "name", "levelname", "levelno", "pathname", "filename", "module"}:
                if not key.startswith("_"):
                    log_entry[key] = value
        return json.dumps(log_entry)

def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())
    return logger
```

```python
# Usage — replace all print() calls:
from agent.lib.logging import get_logger
logger = get_logger(__name__)

# ✗ Before:
print(f"Starting task for user {user_id}")

# ✓ After:
logger.info("Starting task", extra={"user_id": user_id, "task_type": "summarize"})

# Error logging — exception info included automatically
try:
    result = await run_agent(task)
except Exception as e:
    logger.error("Agent task failed", exc_info=True,
                 extra={"user_id": user_id, "task_type": "summarize"})
    raise
```

## Step 3 — Add a Health Endpoint

If the agent runs as a long-lived service (not a one-shot script), add a health endpoint:

```python
# agent/health.py
from fastapi import FastAPI
import httpx
import os
import time

app = FastAPI()
START_TIME = time.time()

@app.get("/health/live")
async def live():
    return {"status": "ok", "uptime": time.time() - START_TIME}

@app.get("/health/ready")
async def ready():
    checks = {}
    healthy = True

    # Check the exported API is reachable
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{os.environ['WORKBENCH_API']}/health/live", timeout=5.0
            )
            checks["api"] = "ok" if r.status_code == 200 else "fail"
            if checks["api"] == "fail":
                healthy = False
    except Exception:
        checks["api"] = "fail"
        healthy = False

    status_code = 200 if healthy else 503
    return {"status": "ready" if healthy else "degraded", "checks": checks}
```

```python
# Run health server alongside the agent
import asyncio
import uvicorn
from agent.health import app as health_app

async def main():
    # Start health server in background
    health_server = uvicorn.Server(uvicorn.Config(health_app, host="0.0.0.0", port=8080))
    health_task = asyncio.create_task(health_server.serve())

    # Run the agent
    await run_agent_loop()

    health_task.cancel()
```

## Step 4 — Graceful Shutdown

```python
# agent/main.py
import signal
import asyncio
from agent.lib.logging import get_logger

logger = get_logger(__name__)

shutdown_event = asyncio.Event()

def handle_sigterm(*args):
    logger.info("SIGTERM received — shutting down gracefully")
    shutdown_event.set()

signal.signal(signal.SIGTERM, handle_sigterm)
signal.signal(signal.SIGINT, handle_sigterm)

async def agent_loop():
    while not shutdown_event.is_set():
        try:
            task = await get_next_task()
            if task:
                await run_agent(task)
        except Exception as e:
            logger.error("Agent loop error", exc_info=True)
        await asyncio.sleep(1)

    logger.info("Agent shutdown complete")
```

## Step 5 — Production Smoke Test

Run this after every deployment before declaring the service healthy:

```bash
#!/usr/bin/env bash
# scripts/agent-smoke-test.sh
set -e

API="${AGENT_URL:-http://localhost:8080}"

echo "=== Agent Smoke Test ==="

# 1. Liveness
status=$(curl -sf "$API/health/live" | jq -r '.status')
[ "$status" = "ok" ] && echo "✓ Liveness" || { echo "✗ Liveness failed"; exit 1; }

# 2. Readiness
ready=$(curl -sf "$API/health/ready" | jq -r '.status')
[ "$ready" = "ready" ] && echo "✓ Readiness" || { echo "✗ Readiness: $ready"; exit 1; }

# 3. Memory round-trip
curl -sf -X POST "$WORKBENCH_API/memory" \
  -H "Content-Type: application/json" \
  -d '{"project":"'"$WORKBENCH_PROJECT"'","key":"smoke:test","value":"ok"}' > /dev/null
value=$(curl -sf "$WORKBENCH_API/memory/$WORKBENCH_PROJECT/smoke:test" | jq -r '.value')
[ "$value" = "ok" ] && echo "✓ Memory API" || { echo "✗ Memory API failed"; exit 1; }

# 4. Run a minimal test task
result=$(curl -sf -X POST "$API/run" \
  -H "Content-Type: application/json" \
  -d '{"task":"What is 2+2?","max_tokens":50}')
echo "$result" | jq -r '.result' | grep -q "4" && echo "✓ Agent runs" || { echo "✗ Agent task failed"; exit 1; }

echo "=== All smoke tests passed ==="
```

## Checklist

- [ ] `WORKBENCH_API` has no default value — fails fast if not set
- [ ] `WORKBENCH_PROJECT` has no default value — fails fast if not set
- [ ] All `print()` statements replaced with structured JSON logger
- [ ] Log level configurable via `LOG_LEVEL` env var
- [ ] Sensitive fields not logged (API keys, user PII)
- [ ] `/health/live` returns 200 without calling external services
- [ ] `/health/ready` checks the exported API endpoint
- [ ] `SIGTERM` handler set — agent finishes current task then exits
- [ ] Smoke test script passes against staging before production deploy
- [ ] `docker-compose.yml` healthcheck configured using `/health/live`

## Files involved

| File | Action |
|------|--------|
| `agent/config.py` | Update: remove defaults from `WORKBENCH_API` and `WORKBENCH_PROJECT` |
| `agent/lib/logging.py` | Create: structured JSON logger |
| `agent/health.py` | Create: FastAPI health endpoints |
| `agent/main.py` | Update: SIGTERM handler, structured logging |
| `scripts/agent-smoke-test.sh` | Create: post-deploy verification |
| `.env.example` | Update: add `WORKBENCH_API`, `WORKBENCH_PROJECT` with example values |

## Common mistakes

**`WORKBENCH_API = os.environ.get("WORKBENCH_API", "http://localhost:3100")`** — the default makes deployment failures silent. Remove the default; require the variable to be set; crash on startup if it's missing.

**Logging to stderr vs stdout** — log aggregators typically capture stdout. Use `sys.stdout` in the handler, not `sys.stderr` (which is for errors and may be captured separately or not at all).

**Running health server on port 80 inside the container** — port 80 requires root. Use port 8080 (or any unprivileged port) inside the container and map it to 80 externally in the compose file.
