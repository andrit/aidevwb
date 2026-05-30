---
name: design-hitl-checkpoints
description: Define which agent operations always require human approval, encode that policy in code independent of debug mode, and handle rejections gracefully
domain: agent-security
type: agent
triggers:
  - "human in the loop"
  - "HITL"
  - "require approval"
  - "agent shouldn't do X without asking"
  - "checkpoint before high-stakes action"
  - "production hold policy"
  - "debug mode in production"
  - "which actions need human approval"
  - "design approval gates"
---

# Design HITL Checkpoints

## When to use

When deploying an agent to production and deciding which operations must never execute without a human seeing them first. This is different from debugging — HITL checkpoints are permanent features of the agent's design, not a diagnostic mode you toggle on and off.

Activate when the user says "the agent shouldn't send emails without my approval", "I want a checkpoint before it writes anything", "which operations need human review?", or "how do I use debug mode for production safety?"

See `docs/17-zero-trust-agent-architecture.md` — Layer 4.

## The Key Distinction

| Debug mode | HITL checkpoints |
|-----------|-----------------|
| Toggle on/off for investigation | Always active for defined operations |
| Holds every tool call | Holds only high-stakes operations |
| Turned off before shipping | Part of the production design |
| Used by developers | Used by end users and operators |

The workbench's step-through debugger (`debug_enable`, `debug_approve`, `debug_reject`) is the HITL mechanism. This skill teaches how to design the **policy** for when it fires — not how to toggle debug mode.

## Prerequisites

- Agent scaffold (`agent.py`) with a `handle_tool()` function
- The workbench debug hold endpoint is operational (`POST /debug/hold`)
- Decision made: what operations in this agent are high-stakes?

## Steps

### 1. Classify every tool into a HITL tier

Before writing code, decide the tier for every tool in `TOOLS`:

```
TIER 1 — AUTO-APPROVE (read-only, reversible, low-blast-radius)
  Examples: rag_query, agent_recall, search_orders, get_status
  Rule: no side effects outside the agent's own memory

TIER 2 — REQUIRE HOLD (write, external, or irreversible)
  Examples: send_email, update_record, push_to_production, post_slack_message
  Rule: creates a visible effect in the world outside the agent

TIER 3 — ALWAYS DENY (out of scope, dangerous, or never appropriate)
  Examples: delete_database, modify_permissions, access_other_projects
  Rule: this agent should never do this, regardless of what it's asked
```

Document the classification before coding it — it makes the policy reviewable:

```python
# agent.py — explicit policy declaration at the top

HITL_POLICY = {
    # TIER 1: execute immediately, no hold
    "auto_approve": [
        "rag_query",
        "agent_recall",
        "agent_remember",    # low risk — internal memory only
        "search_orders",     # read-only lookup
        "get_user_profile",  # read-only
    ],

    # TIER 2: always hold for human approval before executing
    "require_hold": [
        "send_email",        # external communication
        "update_order",      # modifies customer data
        "post_slack",        # external communication
        "create_ticket",     # creates work for someone
        "push_code",         # production system change
    ],

    # TIER 3: never execute under any circumstances
    "deny": [
        "delete_record",
        "modify_permissions",
        "export_all_data",
        "impersonate_user",
    ],
}

# Timeout: if no human approves within this many seconds, auto-reject
HOLD_TIMEOUT_SECONDS = int(os.environ.get("HOLD_TIMEOUT_SECONDS", "300"))  # 5 minutes
```

### 2. Implement policy-aware handle_tool()

Replace the unconditional debug hold with a policy-checked version:

```python
def handle_tool(name: str, inputs: dict) -> str:
    """Execute a tool call subject to the HITL policy."""

    # TIER 3: deny immediately — don't even log as a hold attempt
    if name in HITL_POLICY["deny"]:
        print(json.dumps({
            "event": "tool_denied",
            "tool": name,
            "reason": "policy:deny tier",
            "agent_id": AGENT_ID,
        }), flush=True)
        return (
            f"I cannot execute '{name}' — this operation is outside my permitted scope. "
            f"If you need this done, please do it directly or contact an administrator."
        )

    # TIER 2: always hold for human approval, independent of debug mode
    if name in HITL_POLICY["require_hold"]:
        decision = _request_hold(name, inputs, required=True)
        if decision["approved"] is False:
            return _format_rejection(name, decision.get("reason", ""))
        # Approved — fall through to execution

    # TIER 1 (and approved TIER 2): execute the tool
    # (Skip hold for auto-approve tools — zero latency)
    try:
        return _execute_tool(name, inputs)
    except Exception as e:
        return f"Tool error ({name}): {e}"


def _request_hold(name: str, inputs: dict, required: bool = False) -> dict:
    """
    Submit a hold request. Returns {"approved": True/False, "reason": str}.
    If required=True, this fires regardless of debug mode.
    Times out after HOLD_TIMEOUT_SECONDS and auto-rejects (fail-safe).
    """
    import time

    try:
        resp = http.post("/debug/hold", json={
            "agent": AGENT_ID,
            "tool": name,
            "args": inputs,
            "context": f"Policy requires approval before executing {name}",
            "required": required,           # server respects this even when debug mode is off
            "timeout": HOLD_TIMEOUT_SECONDS,
        }, timeout=HOLD_TIMEOUT_SECONDS + 5)

        data = resp.json()
        approved = data.get("decision") == "approved"
        return {"approved": approved, "reason": data.get("reason", "")}

    except Exception as e:
        # Network error → fail safe: auto-reject
        print(json.dumps({
            "event": "hold_request_failed",
            "tool": name,
            "error": str(e),
        }), flush=True)
        return {"approved": False, "reason": f"Hold request failed: {e}"}


def _format_rejection(tool_name: str, reason: str) -> str:
    """
    Return a user-friendly message when a HITL hold is rejected.
    The agent should explain what it was trying to do and what the user can do instead.
    """
    explanations = {
        "send_email": "send an email on your behalf",
        "update_order": "update a customer order",
        "post_slack": "post a message to Slack",
        "create_ticket": "create a support ticket",
        "push_code": "push code changes to production",
    }
    action = explanations.get(tool_name, f"execute {tool_name}")

    msg = f"I was going to {action}, but that action was not approved."
    if reason:
        msg += f" Reason given: {reason}."
    msg += " Let me know if you'd like me to try a different approach, or if you'd like to do this step yourself."
    return msg


def _execute_tool(name: str, inputs: dict) -> str:
    """Execute an approved tool call. All tools reach here after policy check."""
    if name == "rag_query":
        resp = http.post("/query", json={"question": inputs["question"], "top_k": 5})
        return resp.json().get("answer", "No results found.")

    elif name == "send_email":
        # Tool reaches here only after human approval
        resp = http.post("/email/send", json=inputs)
        return f"Email sent to {inputs.get('to')}."

    # ... other tool handlers ...

    else:
        return f"Unknown tool: {name}"
```

### 3. Design the approver's experience

When a hold fires, the approver sees:

```
[PENDING APPROVAL]
Agent: researcher-a7f3c
Tool: send_email
Args:
  to: alice@acme.com
  subject: Q3 Revenue Summary
  body: "Here are the highlights from our Q3 analysis..."

Context: Policy requires approval before executing send_email

[Approve] [Reject with reason]
Timeout: 4:47 remaining
```

Make the args legible for approval. If `inputs` contains large data (e.g., a full email body), summarize it in the `context` field:

```python
def _build_hold_context(name: str, inputs: dict) -> str:
    """Build a human-readable context string for the approver."""
    if name == "send_email":
        return (
            f"About to send email to {inputs.get('to')} "
            f"with subject: '{inputs.get('subject', '(no subject)')}' "
            f"({len(inputs.get('body', ''))} chars)"
        )
    if name == "update_order":
        return f"About to update order {inputs.get('order_id')} — changes: {list(inputs.keys())}"
    return f"About to execute {name} with {len(inputs)} parameters"
```

### 4. Handle timeout as a rejection

The fail-safe default is **auto-reject on timeout**. If no human responds within `HOLD_TIMEOUT_SECONDS`:

```python
# In _request_hold(): the server-side hold times out and returns:
# {"decision": "rejected", "reason": "timeout — no approval within 300s"}

# The agent receives this as a normal rejection.
# _format_rejection() should include timeout context:
if "timeout" in reason.lower():
    msg += " The approval window expired. If you still want this done, please restart the task."
```

### 5. Test the policy

Verify each tier works as designed:

```python
# test_hitl_policy.py
import asyncio
from unittest.mock import patch, MagicMock
from agent import handle_tool, HITL_POLICY

# Test 1: TIER 3 — deny fires immediately, no network call
def test_deny_tier():
    for tool in HITL_POLICY["deny"]:
        result = handle_tool(tool, {})
        assert "cannot execute" in result.lower() or "outside my permitted scope" in result.lower(), \
            f"Deny tier did not block {tool}"
        assert "Tool error" not in result

# Test 2: TIER 1 — auto-approve doesn't trigger a hold
def test_auto_approve_no_hold():
    with patch("agent.http") as mock_http:
        mock_http.post.return_value = MagicMock(json=lambda: {"answer": "test"})
        result = handle_tool("rag_query", {"question": "test"})
        # Confirm no call to /debug/hold was made
        hold_calls = [c for c in mock_http.post.call_args_list if "/debug/hold" in str(c)]
        assert not hold_calls, "Auto-approve tier incorrectly triggered a hold"

# Test 3: Rejected hold produces a user-friendly message
def test_rejection_message_is_friendly():
    with patch("agent._request_hold", return_value={"approved": False, "reason": "Not authorized"}):
        result = handle_tool("send_email", {"to": "test@example.com", "subject": "Hi"})
        assert "cannot execute" not in result.lower()  # not the deny message
        assert "approved" in result.lower() or "approval" in result.lower()
        assert "Not authorized" in result

print("Running HITL policy tests...")
test_deny_tier()
test_auto_approve_no_hold()
test_rejection_message_is_friendly()
print("All tests passed.")
```

```bash
python test_hitl_policy.py
```

### 6. Add HOLD_TIMEOUT_SECONDS to .env

```bash
# .env
HOLD_TIMEOUT_SECONDS=300   # 5 minutes; adjust based on expected response time
```

For automated pipelines with no human monitor, set this low (30-60s). For interactive use where a human is watching, 5-10 minutes is reasonable.

## Templates

### Minimal HITL_POLICY definition

```python
HITL_POLICY = {
    "auto_approve": [
        # All read-only, reversible, internal tools
    ],
    "require_hold": [
        # All write, external, or irreversible tools
    ],
    "deny": [
        # All tools this agent should never call
    ],
}
```

### Policy classification worksheet

For each tool, ask:
1. Does it have effects visible outside the agent? → `require_hold` or `deny`
2. Can it be undone in < 5 minutes? → lower the tier
3. Does it touch other users' data or resources? → `require_hold` or `deny`
4. Could a malicious actor use it to cause harm? → `deny`

## Checklist

- [ ] Every tool in `TOOLS` is in exactly one tier of `HITL_POLICY`
- [ ] `deny` tier fires immediately with no network call and no debug hold
- [ ] `require_hold` fires regardless of whether debug mode is on or off
- [ ] `auto_approve` tier makes no hold request (zero latency)
- [ ] Rejection produces a user-friendly message with alternative actions
- [ ] Timeout results in auto-rejection (fail-safe)
- [ ] `HOLD_TIMEOUT_SECONDS` in `.env` with a documented rationale for the value
- [ ] `test_hitl_policy.py` passes for all three tiers
- [ ] Policy is reviewed before every production deploy (new tools need classification)

## Files involved

| File | Action |
|------|--------|
| `agent.py` | Add `HITL_POLICY` dict; replace debug hold with `_request_hold()`; add `_format_rejection()`, `_execute_tool()` |
| `test_hitl_policy.py` | Create: tests for each tier |
| `.env` | Add `HOLD_TIMEOUT_SECONDS` |

## Common mistakes

**Treating HITL as debugging** — the hold mechanism exists in the scaffold as a debugging tool. This skill repurposes it as a production security feature. Once a policy is defined, the `require_hold` tier fires in production regardless of whether any developer toggled debug mode.

**Auto-approving tools with write side effects** — `agent_remember` feels safe (it's internal), but if memory is read by downstream agents or exported, it has effects beyond the current session. When in doubt, classify as `require_hold`.

**Crash on rejection** — a rejected HITL hold is not an error. The agent should explain what it was trying to do and ask for guidance. Raising an exception or returning a raw error string breaks the conversation flow.

**Not testing the deny tier** — the deny tier is often skipped in testing because "the agent would never call those tools anyway." But prompt injection can cause exactly that — an adversarial input that tricks the agent into trying to call `delete_record`. The test that verifies the deny tier blocks it is the most important test in the suite.

**Timeout too long for automated pipelines** — a 10-minute timeout means an automated test suite or CI pipeline sits blocked for 10 minutes waiting for a human who will never approve. Set a short timeout for non-interactive environments and fail clearly.
