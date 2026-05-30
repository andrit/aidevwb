---
name: connect-external-api
description: Add an httpx client for an external API, define an agent tool for it, handle API key and OAuth auth, implement error handling and rate limiting
domain: agent
type: agent
triggers:
  - "connect to an external API"
  - "call an external service"
  - "integrate with X API"
  - "add a Slack tool"
  - "add a GitHub tool"
  - "add a Stripe tool"
  - "the agent should call an external API"
  - "API key authentication"
  - "OAuth"
  - "rate limiting"
---

# Connect an External API

## When to use

When an agent needs to call an external service — Slack, GitHub, Stripe, a weather API, an internal microservice, etc. Activate when the user says "connect to the Slack API", "the agent should be able to create GitHub issues", "add a tool that calls our billing API", or "integrate with X".

## Prerequisites

- Agent scaffold (`agent.py`) exists with a `TOOLS` list and `handle_tool`
- API credentials available (API key, OAuth tokens, or service account)
- `httpx` is in `requirements.txt` (it is by default in all workbench scaffolds)
- The external API's documentation is available (know the base URL, auth method, and the endpoints you'll use)

## Steps

### 1. Add credentials to .env

```bash
# .env
SLACK_BOT_TOKEN=xoxb-...
GITHUB_TOKEN=ghp_...
STRIPE_SECRET_KEY=sk_live_...
INTERNAL_API_KEY=...
INTERNAL_API_URL=https://api.internal.acme.com
```

Never hardcode credentials in `agent.py`. Always read from environment variables.

### 2. Create a dedicated API client module

For non-trivial integrations, put the client in its own module. This makes it testable in isolation and keeps `agent.py` readable.

```python
# api_clients/slack.py
import os
import httpx
from typing import Optional

SLACK_BASE = "https://slack.com/api"
_token = os.environ.get("SLACK_BOT_TOKEN", "")

# Shared client — reuses connections, respects timeouts
_client = httpx.Client(
    base_url=SLACK_BASE,
    headers={
        "Authorization": f"Bearer {_token}",
        "Content-Type": "application/json",
    },
    timeout=10.0,
)


def send_message(channel: str, text: str, thread_ts: Optional[str] = None) -> dict:
    """Post a message to a Slack channel. Returns the Slack API response."""
    payload = {"channel": channel, "text": text}
    if thread_ts:
        payload["thread_ts"] = thread_ts

    resp = _client.post("/chat.postMessage", json=payload)
    resp.raise_for_status()
    data = resp.json()

    if not data.get("ok"):
        raise ValueError(f"Slack API error: {data.get('error', 'unknown')}")

    return data


def get_channel_history(channel: str, limit: int = 10) -> list[dict]:
    """Fetch recent messages from a channel."""
    resp = _client.get("/conversations.history", params={"channel": channel, "limit": limit})
    resp.raise_for_status()
    data = resp.json()

    if not data.get("ok"):
        raise ValueError(f"Slack API error: {data.get('error', 'unknown')}")

    return data.get("messages", [])
```

### 3. Define the tool schema

```python
# agent.py — add to TOOLS
TOOLS = [
    # ... existing tools ...
    {
        "name": "slack_send_message",
        "description": (
            "Send a message to a Slack channel. Use when the user asks you to notify "
            "a channel, post an update, or send a message in Slack. "
            "The channel parameter should be the channel name (e.g. #alerts) or ID."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "channel": {
                    "type": "string",
                    "description": "Slack channel name (e.g. general) or channel ID"
                },
                "message": {
                    "type": "string",
                    "description": "The message text to send"
                }
            },
            "required": ["channel", "message"]
        }
    },
    {
        "name": "slack_get_history",
        "description": (
            "Read recent messages from a Slack channel. Use when the user wants to see "
            "what was posted in a channel or needs context from recent Slack activity."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "channel": {
                    "type": "string",
                    "description": "Slack channel name or ID"
                },
                "limit": {
                    "type": "integer",
                    "description": "Number of recent messages to fetch (default 10, max 50)",
                    "default": 10
                }
            },
            "required": ["channel"]
        }
    },
]
```

### 4. Implement the handler

```python
# agent.py — add to handle_tool()
from api_clients.slack import send_message, get_channel_history

def handle_tool(name: str, inputs: dict) -> str:
    try:
        # ... debug hold ...

        if name == "slack_send_message":
            channel = inputs["channel"].lstrip("#")   # normalize: "general" not "#general"
            message = inputs["message"]

            result = send_message(channel=channel, text=message)
            ts = result.get("ts", "")
            return f"Message sent to #{channel} (timestamp: {ts})"

        elif name == "slack_get_history":
            channel = inputs["channel"].lstrip("#")
            limit = min(inputs.get("limit", 10), 50)   # cap at 50 regardless of what model asks

            messages = get_channel_history(channel=channel, limit=limit)
            if not messages:
                return f"No recent messages found in #{channel}."

            lines = [f"Recent {len(messages)} messages in #{channel}:"]
            for msg in messages:
                user = msg.get("user", "unknown")
                text = msg.get("text", "")[:200]   # truncate long messages
                ts = msg.get("ts", "")[:10]        # just the date part
                lines.append(f"  [{ts}] {user}: {text}")
            return "\n".join(lines)

        # ... other tools ...

    except Exception as e:
        return f"Tool error ({name}): {e}"
```

### 5. Handle common auth patterns

#### API Key (Bearer token)

```python
# In the httpx client
_client = httpx.Client(
    base_url="https://api.example.com",
    headers={"Authorization": f"Bearer {os.environ['API_KEY']}"},
    timeout=15.0,
)
```

#### API Key (custom header)

```python
_client = httpx.Client(
    base_url="https://api.example.com",
    headers={"X-API-Key": os.environ["API_KEY"]},
)
```

#### Basic auth

```python
_client = httpx.Client(
    base_url="https://api.example.com",
    auth=(os.environ["API_USER"], os.environ["API_PASSWORD"]),
)
```

#### OAuth (pre-obtained token, stored in env)

```python
# For OAuth, obtain the token outside the agent (OAuth flow is interactive).
# Store the access token and optionally the refresh token in .env.
# Refresh logic if needed:
def _refresh_token():
    resp = httpx.post("https://auth.example.com/token", data={
        "grant_type": "refresh_token",
        "refresh_token": os.environ["REFRESH_TOKEN"],
        "client_id": os.environ["CLIENT_ID"],
        "client_secret": os.environ["CLIENT_SECRET"],
    })
    resp.raise_for_status()
    return resp.json()["access_token"]
```

### 6. Rate limiting and retries

```python
# api_clients/base.py — shared retry logic
import time
import httpx
from typing import Callable, TypeVar

T = TypeVar("T")

def with_retry(fn: Callable[[], T], max_retries: int = 3, backoff: float = 1.0) -> T:
    """Retry a function on 429 (rate limit) or 5xx errors with exponential backoff."""
    for attempt in range(max_retries):
        try:
            return fn()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                # Respect Retry-After header if present
                retry_after = float(e.response.headers.get("Retry-After", backoff * (2 ** attempt)))
                time.sleep(retry_after)
            elif e.response.status_code >= 500 and attempt < max_retries - 1:
                time.sleep(backoff * (2 ** attempt))
            else:
                raise
    raise RuntimeError(f"Failed after {max_retries} attempts")


# Usage in a client function
def search_issues(query: str) -> list[dict]:
    def _call():
        resp = _client.get("/search/issues", params={"q": query})
        resp.raise_for_status()
        return resp.json()["items"]

    return with_retry(_call)
```

### 7. Test the client in isolation

```python
# test_api_clients.py
import os
os.environ["SLACK_BOT_TOKEN"] = "xoxb-test-..."  # use a test workspace token

from api_clients.slack import send_message, get_channel_history

# Test send
result = send_message("test-bot-channel", "Hello from agent test")
print("Send result:", result.get("ok"))
assert result.get("ok"), f"Send failed: {result}"

# Test read
messages = get_channel_history("test-bot-channel", limit=5)
print(f"Fetched {len(messages)} messages")
```

```bash
python test_api_clients.py
```

### 8. Test in the agent loop

```bash
python agent.py "Send a message to the #alerts channel: 'Deploy completed successfully'"
python agent.py "What are the last 5 messages in #general?"
```

### 9. Add eval scenarios

```json
{
  "name": "sends-slack-notification-when-asked",
  "description": "Agent calls slack_send_message when asked to send a Slack notification",
  "turns": [
    {
      "role": "user",
      "content": "Send a message to the alerts channel saying the deploy is done."
    },
    {
      "expect": {
        "tool_called": "slack_send_message",
        "tool_args_contain": {"channel": "alerts"},
        "response_contains": ["sent", "message", "alerts"]
      }
    }
  ]
}
```

## Templates

### Minimal external API client

```python
# api_clients/my_api.py
import os
import httpx

_client = httpx.Client(
    base_url=os.environ.get("MY_API_URL", "https://api.example.com"),
    headers={"Authorization": f"Bearer {os.environ.get('MY_API_KEY', '')}"},
    timeout=15.0,
)


def call_endpoint(param: str) -> dict:
    resp = _client.get("/endpoint", params={"param": param})
    resp.raise_for_status()
    return resp.json()
```

### Handler with comprehensive error handling

```python
elif name == "my_api_tool":
    try:
        result = call_endpoint(inputs["param"])
        return format_result(result)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            return "API authentication failed. Check that MY_API_KEY is set correctly."
        elif e.response.status_code == 404:
            return f"Not found: {inputs['param']}"
        elif e.response.status_code == 429:
            return "API rate limit reached. Please try again in a moment."
        else:
            return f"API error: HTTP {e.response.status_code}"
    except httpx.TimeoutException:
        return "API request timed out. The service may be slow — try again."
    except httpx.RequestError as e:
        return f"Network error reaching API: {e}"
```

## Checklist

- [ ] Credentials in `.env`, read via `os.environ` — never hardcoded
- [ ] `.env` is in `.gitignore`
- [ ] API client in its own module (`api_clients/<service>.py`)
- [ ] Shared `httpx.Client` instance (reuses connections — not `httpx.get()` per call)
- [ ] `timeout=` set on the client (prevents agent from hanging indefinitely)
- [ ] Handler catches `HTTPStatusError`, `TimeoutException`, and `RequestError` separately
- [ ] 429 rate limit handled with backoff (or at minimum a clear error message)
- [ ] Tool results truncated to a reasonable length (long API responses waste tokens)
- [ ] API client tested in isolation before wiring into the agent loop
- [ ] Eval scenario added for the new tool

## Files involved

| File | Action |
|------|--------|
| `.env` | Add API credentials |
| `.gitignore` | Verify `.env` is listed |
| `requirements.txt` | Add any new packages (httpx is already included) |
| `api_clients/<service>.py` | Create API client module |
| `agent.py` | Add tool to `TOOLS`, add handler branch in `handle_tool` |
| `test_api_clients.py` | Create isolation test |
| `evals/scenarios.json` | Add eval scenario |

## Common mistakes

**Hardcoding credentials** — API keys committed to git are exposed publicly even if later removed (git history). Always use environment variables.

**New `httpx.Client()` per request** — creating a new client instance for every tool call means a new TCP connection every time. Create one client at module level and reuse it.

**No timeout on the client** — without a timeout, a slow or unresponsive external API will hang the agent indefinitely. Always set `timeout=15.0` (or appropriate for the API's SLA).

**Not handling 429** — rate limits are common with external APIs. Without handling, the agent sees a cryptic error and may retry immediately, making it worse. At minimum, return a clear "rate limit reached, try again later" message.

**Returning full API payloads** — external APIs often return large JSON objects. The model reads the entire tool result, so returning a 50KB JSON blob wastes context window and confuses the model. Extract and format only what's relevant.

**Forgetting `.env` in `.gitignore`** — after adding credentials to `.env`, verify it's in `.gitignore` before committing anything. Run `git status` and confirm `.env` doesn't appear.
