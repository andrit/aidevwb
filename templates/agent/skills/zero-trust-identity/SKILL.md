---
name: zero-trust-identity
description: Assign each agent a unique runtime identity, scope its credentials by role, and tag every workbench API call so actions are attributable and revocable per agent
domain: agent-security
type: agent
triggers:
  - "agent identity"
  - "per-agent credentials"
  - "agents share credentials"
  - "which agent made this call"
  - "zero trust identity"
  - "scope agent permissions"
  - "agent is not the user"
  - "credential isolation"
---

# Zero Trust Agent Identity

## When to use

When deploying an agent to production, when multiple agents run in the same project and share an API key, or when you need to answer "which agent made this call?" in an audit log. Activate when the user says "agents are sharing credentials", "I need to know which agent did X", "scope the agent's permissions", or when implementing zero trust architecture.

See `docs/17-zero-trust-agent-architecture.md` — Layer 1.

## Prerequisites

- Agent scaffold (`agent.py`) exists with a `handle_tool()` function
- Workbench services running or a production API endpoint configured
- `PyJWT` available: `pip install PyJWT` (add to `requirements.txt`)
- A `WORKBENCH_SECRET` in `.env` — used to sign agent tokens (min 32 chars, not the same as `ANTHROPIC_API_KEY`)

## The Problem This Solves

Without per-agent identity, all API calls from all agents look identical in logs:

```
[2025-01-15 10:30:01] POST /query     X-Project: my-project  → 200
[2025-01-15 10:30:02] POST /query     X-Project: my-project  → 200
[2025-01-15 10:30:03] PUT  /memory/x  X-Project: my-project  → 200
```

Which agent wrote to `/memory/x`? You cannot tell. If one agent is misbehaving, you cannot revoke just its access — you must take down everything.

With per-agent identity:

```
[2025-01-15 10:30:01] POST /query     agent=researcher  task=task-abc  → 200
[2025-01-15 10:30:02] POST /query     agent=analyst     task=task-abc  → 200
[2025-01-15 10:30:03] PUT  /memory/x  agent=researcher  task=task-abc  → 200
```

Now you can answer "which agent touched what", and you can revoke the researcher's token without affecting the analyst.

## Steps

### 1. Add the identity module

```python
# identity.py — generate and attach per-agent identity
import os
import uuid
import time
import jwt   # pip install PyJWT

WORKBENCH_SECRET = os.environ.get("WORKBENCH_SECRET", "")
if not WORKBENCH_SECRET or len(WORKBENCH_SECRET) < 32:
    raise ValueError("WORKBENCH_SECRET must be set and at least 32 characters")


def generate_agent_token(
    agent_name: str,
    project: str,
    allowed_tools: list[str],
    task_id: str | None = None,
    ttl_seconds: int = 3600,
) -> tuple[str, str]:
    """
    Generate a per-agent JWT and a unique instance ID.
    Returns (agent_id, token).

    The token encodes: who this agent is, what project it belongs to,
    which tools it is allowed to call, and when the token expires.
    """
    agent_id = str(uuid.uuid4())
    task_id = task_id or str(uuid.uuid4())

    payload = {
        "agent_id": agent_id,
        "agent_name": agent_name,
        "project": project,
        "task_id": task_id,
        "allowed_tools": allowed_tools,
        "iat": int(time.time()),
        "exp": int(time.time()) + ttl_seconds,
    }

    token = jwt.encode(payload, WORKBENCH_SECRET, algorithm="HS256")
    return agent_id, token


def verify_agent_token(token: str) -> dict:
    """Decode and verify an agent token. Raises jwt.ExpiredSignatureError if expired."""
    return jwt.decode(token, WORKBENCH_SECRET, algorithms=["HS256"])
```

### 2. Generate identity at agent startup

Add this near the top of `agent.py`, before the `httpx.Client` is created:

```python
# agent.py
import os
from identity import generate_agent_token

WORKBENCH_API = os.environ.get("WORKBENCH_API", "http://localhost:3100")
WORKBENCH_PROJECT = os.environ.get("WORKBENCH_PROJECT", "{{PROJECT_NAME}}")

# Define which tools this agent instance is allowed to call
ALLOWED_TOOLS = ["rag_query", "agent_remember", "agent_recall"]

# Generate a unique identity for this agent run
AGENT_ID, AGENT_TOKEN = generate_agent_token(
    agent_name="assistant",        # matches the agent's role name
    project=WORKBENCH_PROJECT,
    allowed_tools=ALLOWED_TOOLS,
    ttl_seconds=3600,              # expires after 1 hour
)

# Attach identity to every workbench API call
http = httpx.Client(
    base_url=WORKBENCH_API,
    headers={
        "X-Project": WORKBENCH_PROJECT,
        "X-Agent-ID": AGENT_ID,
        "X-Agent-Token": AGENT_TOKEN,
    },
    timeout=30.0,
)
```

### 3. Enforce allowed tools in handle_tool()

Before executing any tool, check that it is in the agent's allowed list:

```python
def handle_tool(name: str, inputs: dict) -> str:
    """Execute a tool call — reject if not in this agent's allowed list."""

    # Identity enforcement: block tools not in this agent's scope
    if name not in ALLOWED_TOOLS:
        # Log the attempt — this is a security event
        print(f"[SECURITY] Agent {AGENT_ID} attempted to call {name} — not in allowed_tools", flush=True)
        return f"Tool '{name}' is not permitted for this agent. Allowed: {', '.join(ALLOWED_TOOLS)}"

    try:
        # ... existing debug hold ...
        # ... tool handlers ...
```

### 4. Scope external API credentials by role

When connecting to external APIs, use role-specific credentials — not one shared key:

```python
# .env — separate credentials per agent role
RESEARCHER_SLACK_TOKEN=xoxb-read-only-...    # only can read channels
NOTIFIER_SLACK_TOKEN=xoxb-post-only-...      # only can post messages
ANALYST_GITHUB_TOKEN=ghp_read-only-...       # read-only repo access

# agent.py — each agent type reads only its credentials
AGENT_ROLE = os.environ.get("AGENT_ROLE", "assistant")

EXTERNAL_CREDENTIALS = {
    "researcher": {
        "slack_token": os.environ.get("RESEARCHER_SLACK_TOKEN", ""),
    },
    "notifier": {
        "slack_token": os.environ.get("NOTIFIER_SLACK_TOKEN", ""),
    },
    "analyst": {
        "github_token": os.environ.get("ANALYST_GITHUB_TOKEN", ""),
    },
}

# In handle_tool():
elif name == "slack_read":
    creds = EXTERNAL_CREDENTIALS.get(AGENT_ROLE, {})
    token = creds.get("slack_token")
    if not token:
        return f"No Slack credentials configured for role '{AGENT_ROLE}'"
    # ... use token ...
```

### 5. Log identity on every tool call

Include `agent_id` and `task_id` in all tool call logs so the audit trail is complete:

```python
import json, sys

def log_tool_call(name: str, inputs: dict, result: str, agent_id: str, task_id: str):
    """Structured log entry for every tool call."""
    entry = {
        "event": "tool_call",
        "agent_id": agent_id,
        "task_id": task_id,
        "tool": name,
        "input_keys": list(inputs.keys()),   # log keys but not values (may contain PII)
        "result_length": len(result),
        "ok": not result.startswith("Tool error"),
    }
    print(json.dumps(entry), flush=True)     # structured JSON → log aggregator

# In handle_tool(), after executing:
log_tool_call(name, inputs, result, AGENT_ID, task_id)
```

### 6. Revocation pattern

If an agent needs to be stopped mid-run (misbehaving, compromise suspected):

```python
# Revoke by setting a revocation flag in Redis or the workbench
# The agent checks this flag at the start of each tool call:

def is_revoked(agent_id: str) -> bool:
    """Check if this agent's token has been revoked."""
    try:
        resp = http.get(f"/agent/revoked/{agent_id}")
        return resp.json().get("revoked", False)
    except Exception:
        return False   # fail open on check error; fail closed via token expiry

def handle_tool(name: str, inputs: dict) -> str:
    # Check revocation before every tool call
    if is_revoked(AGENT_ID):
        sys.exit(1)   # hard stop — agent loop terminates

    # ... rest of handler ...
```

### 7. Install and update requirements

```bash
pip install PyJWT
echo "PyJWT>=2.8.0" >> requirements.txt
```

## Templates

### Minimal identity setup (copy-paste into agent.py)

```python
# --- Identity setup (add near top of agent.py) ---
import uuid, time, jwt, json, sys

WORKBENCH_SECRET = os.environ["WORKBENCH_SECRET"]   # fail fast if missing
AGENT_ROLE = os.environ.get("AGENT_ROLE", "assistant")
AGENT_NAME = f"{AGENT_ROLE}-{uuid.uuid4().hex[:8]}"  # unique per instance
TASK_ID = str(uuid.uuid4())
ALLOWED_TOOLS = ["rag_query", "agent_remember", "agent_recall"]  # scope to role

_payload = {
    "agent_name": AGENT_NAME, "project": WORKBENCH_PROJECT,
    "task_id": TASK_ID, "allowed_tools": ALLOWED_TOOLS,
    "exp": int(time.time()) + 3600,
}
AGENT_TOKEN = jwt.encode(_payload, WORKBENCH_SECRET, algorithm="HS256")
AGENT_ID = f"{AGENT_ROLE}-{uuid.uuid4()}"

http = httpx.Client(
    base_url=WORKBENCH_API,
    headers={"X-Project": WORKBENCH_PROJECT, "X-Agent-ID": AGENT_ID, "X-Agent-Token": AGENT_TOKEN},
    timeout=30.0,
)
# --- end identity setup ---
```

## Checklist

- [ ] `WORKBENCH_SECRET` in `.env`, minimum 32 characters, not the Anthropic key
- [ ] `identity.py` raises `ValueError` at startup if secret is missing or too short
- [ ] `AGENT_ID` and `AGENT_TOKEN` generated at startup before any API calls
- [ ] `X-Agent-ID` and `X-Agent-Token` headers on every `http` call
- [ ] `ALLOWED_TOOLS` contains only tools this agent role needs (not all tools)
- [ ] `handle_tool()` rejects calls to tools outside `ALLOWED_TOOLS`
- [ ] External credentials are role-specific env vars, not one shared key
- [ ] Every tool call logs `agent_id` and `task_id` as structured JSON
- [ ] `PyJWT>=2.8.0` in `requirements.txt`

## Files involved

| File | Action |
|------|--------|
| `identity.py` | Create: token generation and verification |
| `agent.py` | Add identity setup block; update `http` client headers; add tool allowlist check in `handle_tool()` |
| `requirements.txt` | Add `PyJWT>=2.8.0` |
| `.env` | Add `WORKBENCH_SECRET`, role-specific external credential vars |

## Common mistakes

**Reusing `ANTHROPIC_API_KEY` as the JWT secret** — the Anthropic key is sent to external APIs and may appear in logs. The `WORKBENCH_SECRET` must be a separate, internally-used secret.

**Setting `ALLOWED_TOOLS` to everything** — `ALLOWED_TOOLS = [t["name"] for t in TOOLS]` defeats the point. Define it explicitly based on the agent's role, not programmatically from the tool list.

**Not logging input keys (only values)** — tool inputs may contain PII, credentials, or sensitive data. Log the key names (`input_keys`) for auditability; do not log the values themselves.

**Token TTL longer than a task** — a 24-hour token for a task that takes 5 minutes means the token can be replayed for the rest of the day. Set TTL to a reasonable upper bound for the task duration (1-2 hours maximum).

**Failing open on revocation check errors** — if the revocation check fails with a network error, the agent should continue (tokens expire naturally). But if the revocation check returns `{"revoked": true}`, that must cause an immediate halt, not a log-and-continue.
