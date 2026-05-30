---
name: setup-circuit-breakers
description: Define behavioral thresholds, implement a soft circuit breaker in the agent loop, surface violations via OTel spans, and create Grafana alert rules that halt runaway agents
domain: agent-security
type: agent
triggers:
  - "circuit breaker"
  - "agent is looping"
  - "runaway agent"
  - "kill switch"
  - "behavioral monitoring"
  - "agent cost spike"
  - "agent won't stop"
  - "alert when agent misbehaves"
  - "monitor agent behavior"
  - "agent rate limiting"
---

# Setup Circuit Breakers

## When to use

Before deploying an agent to unsupervised production operation, or after observing a runaway loop or unexpected behavior spike. Activate when the user says "the agent won't stop", "I need a kill switch", "alert me if the agent calls too many tools", "the agent is costing too much", or "how do I stop a misbehaving agent automatically?"

See `docs/17-zero-trust-agent-architecture.md` — Layer 5.

## Prerequisites

- Agent scaffold (`agent.py`) exists with a `run_agent()` loop and `handle_tool()`
- OTel tracing configured (see `docs/phase-3a2-report.md`)
- Grafana running (workbench provides this via `make up`)
- `zero-trust-identity` skill applied (circuit breaker needs `AGENT_ID` and `TASK_ID`)

## What Circuit Breakers Do

A circuit breaker watches the agent's behavior in real time. When a metric crosses a threshold, it acts automatically — no human needs to be watching.

```
Normal operation:
  Tool calls: 1, 2, 3 → normal
  Same tool 3× in a row → warn
  Same tool 5× in a row → CIRCUIT OPEN → all further tool calls blocked

Runaway loop detection:
  20 tool calls in one task → CIRCUIT OPEN

Cost protection:
  Estimated tokens > 30,000 → CIRCUIT OPEN

Rejection cascade:
  3 HITL holds rejected in a row → CIRCUIT OPEN (agent is being steered wrong)
```

When the circuit opens, the agent receives a clear signal to stop and explain what happened, rather than continuing until it hits `MAX_TURNS` or exhausts the API quota.

## Steps

### 1. Create the CircuitBreaker class

```python
# circuit_breaker.py
import json
import time
import sys
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CircuitBreakerConfig:
    """Thresholds that trigger the circuit breaker. Override via environment."""
    max_tool_calls: int = 20           # total tool calls per task
    max_consecutive_same: int = 5      # same tool N times in a row
    max_rejected_holds: int = 3        # HITL rejections per task
    max_estimated_tokens: int = 40_000 # estimated input tokens per task
    max_payload_bytes: int = 10_240    # single tool result > 10KB is suspicious


@dataclass
class CircuitBreakerState:
    """Mutable state tracked per agent run."""
    config: CircuitBreakerConfig = field(default_factory=CircuitBreakerConfig)
    total_calls: int = 0
    consecutive_same: int = 0
    last_tool: str = ""
    rejected_holds: int = 0
    estimated_tokens: int = 0
    open: bool = False
    open_reason: str = ""
    opened_at: Optional[float] = None

    def record_tool_call(self, tool_name: str, input_tokens: int = 0) -> Optional[str]:
        """
        Record a tool call. Returns a trip reason string if the circuit should open,
        None if operation should continue.
        """
        if self.open:
            return self.open_reason   # already open

        self.total_calls += 1
        self.estimated_tokens += input_tokens

        # Track consecutive same-tool calls
        if tool_name == self.last_tool:
            self.consecutive_same += 1
        else:
            self.consecutive_same = 1
            self.last_tool = tool_name

        # Evaluate thresholds
        if self.total_calls > self.config.max_tool_calls:
            return f"total tool calls ({self.total_calls}) exceeded limit ({self.config.max_tool_calls})"

        if self.consecutive_same >= self.config.max_consecutive_same:
            return f"'{tool_name}' called {self.consecutive_same} times consecutively — possible loop"

        if self.estimated_tokens > self.config.max_estimated_tokens:
            return f"estimated token usage ({self.estimated_tokens:,}) exceeded limit"

        return None  # all clear

    def record_hold_rejection(self) -> Optional[str]:
        """Record a HITL rejection. Returns trip reason if threshold hit."""
        self.rejected_holds += 1
        if self.rejected_holds >= self.config.max_rejected_holds:
            return f"{self.rejected_holds} consecutive HITL rejections — task may be misaligned"
        return None

    def record_large_payload(self, tool_name: str, payload_bytes: int) -> Optional[str]:
        """Check for abnormally large tool results (potential exfiltration)."""
        if payload_bytes > self.config.max_payload_bytes:
            return (
                f"'{tool_name}' returned {payload_bytes:,} bytes — "
                f"exceeds {self.config.max_payload_bytes:,} byte threshold"
            )
        return None

    def trip(self, reason: str):
        """Open the circuit. All subsequent tool calls are blocked."""
        self.open = True
        self.open_reason = reason
        self.opened_at = time.time()
```

### 2. Wire it into handle_tool()

```python
# agent.py
from circuit_breaker import CircuitBreakerConfig, CircuitBreakerState

# One breaker per task run — instantiate at module level or per run_agent() call
_breaker = CircuitBreakerState(config=CircuitBreakerConfig(
    max_tool_calls=int(os.environ.get("CB_MAX_TOOL_CALLS", "20")),
    max_consecutive_same=int(os.environ.get("CB_MAX_CONSECUTIVE", "5")),
    max_rejected_holds=int(os.environ.get("CB_MAX_REJECTIONS", "3")),
    max_estimated_tokens=int(os.environ.get("CB_MAX_TOKENS", "40000")),
))


def handle_tool(name: str, inputs: dict) -> str:
    """Execute a tool — blocked if circuit is open."""

    # Estimate input tokens (rough: 1 token ≈ 4 chars of JSON)
    input_size = len(json.dumps(inputs))
    estimated_input_tokens = input_size // 4

    # Check circuit breaker before executing
    trip_reason = _breaker.record_tool_call(name, input_tokens=estimated_input_tokens)
    if trip_reason:
        _breaker.trip(trip_reason)
        _log_circuit_event("circuit_open", trip_reason, name)
        return (
            f"[CIRCUIT BREAKER OPEN] I've stopped because: {trip_reason}. "
            f"Stats: {_breaker.total_calls} tool calls, "
            f"~{_breaker.estimated_tokens:,} tokens used. "
            f"Please review what I've done so far and restart if needed."
        )

    # ... HITL policy check (from design-hitl-checkpoints skill) ...

    try:
        result = _execute_tool(name, inputs)

        # Check payload size after execution
        payload_bytes = len(result.encode("utf-8"))
        size_trip = _breaker.record_large_payload(name, payload_bytes)
        if size_trip:
            _breaker.trip(size_trip)
            _log_circuit_event("large_payload_detected", size_trip, name)
            # Don't block the current result — but next call will be blocked
            print(json.dumps({"event": "large_payload_warning", "tool": name,
                              "bytes": payload_bytes}), flush=True)

        return result

    except Exception as e:
        return f"Tool error ({name}): {e}"


def _log_circuit_event(event_type: str, reason: str, tool: str):
    """Emit a structured log event. Picked up by OTel collector → Tempo → Grafana."""
    print(json.dumps({
        "event": event_type,
        "agent_id": AGENT_ID,
        "task_id": TASK_ID,
        "tool": tool,
        "reason": reason,
        "stats": {
            "total_calls": _breaker.total_calls,
            "consecutive_same": _breaker.consecutive_same,
            "rejected_holds": _breaker.rejected_holds,
            "estimated_tokens": _breaker.estimated_tokens,
        },
    }), flush=True)
```

### 3. Check circuit state in the agent loop

The circuit also needs to be checked at the top of each loop iteration, not just in `handle_tool`:

```python
def run_agent(user_message: str) -> str:
    """Agent loop with circuit breaker integration."""
    global _breaker
    _breaker = CircuitBreakerState(config=CircuitBreakerConfig())  # fresh per task

    messages = [{"role": "user", "content": user_message}]

    for turn in range(MAX_TURNS):
        # Check circuit at loop entry — in case it was tripped by a tool result check
        if _breaker.open:
            return (
                f"Task halted: {_breaker.open_reason}. "
                f"Completed {_breaker.total_calls} tool calls before stopping."
            )

        response = client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        tool_calls = [b for b in response.content if b.type == "tool_use"]
        if not tool_calls:
            text = "".join(b.text for b in response.content if b.type == "text")
            return text

        messages.append({"role": "assistant", "content": response.content})
        tool_results = []
        for tc in tool_calls:
            result = handle_tool(tc.name, tc.input)

            # If circuit opened during this tool call, stop the loop immediately
            if _breaker.open:
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tc.id,
                    "content": result,
                })
                messages.append({"role": "user", "content": tool_results})
                # One final model call to get a graceful wrap-up
                final = client.messages.create(
                    model=MODEL, max_tokens=512, system=SYSTEM_PROMPT, messages=messages
                )
                return "".join(b.text for b in final.content if b.type == "text")

            tool_results.append({"type": "tool_result", "tool_use_id": tc.id, "content": result})

        messages.append({"role": "user", "content": tool_results})

    return f"Reached maximum turns ({MAX_TURNS}) without completing."
```

### 4. Add circuit breaker config to .env

```bash
# .env — circuit breaker thresholds (tune per agent)
CB_MAX_TOOL_CALLS=20       # total tool calls per task
CB_MAX_CONSECUTIVE=5       # same tool N times in a row
CB_MAX_REJECTIONS=3        # HITL rejections before halt
CB_MAX_TOKENS=40000        # estimated token budget per task
```

### 5. Create a Grafana alert rule for circuit trips

In Grafana (`http://localhost:3000`), create an alert rule on the log stream from the agent container:

```
Alert name: Agent Circuit Breaker Tripped
Datasource: Loki (or your log aggregator)
Query:
  {job="agent"} |= "circuit_open"
  | json
  | event = "circuit_open"

Condition: count() > 0 in last 5 minutes
Alert: FIRE

Notification:
  Summary: "Agent circuit breaker opened — task halted"
  Body: "Agent {{ agent_id }} halted on task {{ task_id }}. Reason: {{ reason }}"
```

If using OTel spans instead of logs, add the circuit event as a span with `status=ERROR`:

```python
from opentelemetry import trace

tracer = trace.get_tracer("agent")

def _log_circuit_event(event_type: str, reason: str, tool: str):
    with tracer.start_as_current_span("circuit_breaker_event") as span:
        span.set_attribute("event.type", event_type)
        span.set_attribute("agent.id", AGENT_ID)
        span.set_attribute("task.id", TASK_ID)
        span.set_attribute("tool.name", tool)
        span.set_attribute("circuit.reason", reason)
        span.set_attribute("circuit.total_calls", _breaker.total_calls)
        span.set_status(trace.StatusCode.ERROR, reason)
    # Also log as JSON for log aggregators
    print(json.dumps({...}), flush=True)
```

### 6. Test the circuit breaker

```python
# test_circuit_breaker.py
from circuit_breaker import CircuitBreakerConfig, CircuitBreakerState

def test_trips_on_max_calls():
    cb = CircuitBreakerState(config=CircuitBreakerConfig(max_tool_calls=3))
    cb.record_tool_call("rag_query")
    cb.record_tool_call("rag_query")
    reason = cb.record_tool_call("rag_query")
    assert reason is not None, "Should trip at call #3"
    assert "3" in reason

def test_trips_on_consecutive_same():
    cb = CircuitBreakerState(config=CircuitBreakerConfig(max_consecutive_same=3))
    cb.record_tool_call("rag_query")
    cb.record_tool_call("rag_query")
    reason = cb.record_tool_call("rag_query")
    assert reason is not None, "Should trip on 3 consecutive rag_query calls"

def test_resets_consecutive_on_different_tool():
    cb = CircuitBreakerState(config=CircuitBreakerConfig(max_consecutive_same=3))
    cb.record_tool_call("rag_query")
    cb.record_tool_call("rag_query")
    cb.record_tool_call("agent_remember")   # different tool
    reason = cb.record_tool_call("rag_query")
    assert reason is None, "Consecutive count should reset on tool change"

def test_large_payload_flagged():
    cb = CircuitBreakerState(config=CircuitBreakerConfig(max_payload_bytes=100))
    reason = cb.record_large_payload("search_api", 500)
    assert reason is not None and "500" in reason

print("Running circuit breaker tests...")
test_trips_on_max_calls()
test_trips_on_consecutive_same()
test_resets_consecutive_on_different_tool()
test_large_payload_flagged()
print("All tests passed.")
```

```bash
python test_circuit_breaker.py
```

## Checklist

- [ ] `circuit_breaker.py` created with `CircuitBreakerConfig` and `CircuitBreakerState`
- [ ] `_breaker` reset fresh at the start of each `run_agent()` call (not shared across tasks)
- [ ] `handle_tool()` checks circuit before executing, and checks large payload after
- [ ] `run_agent()` loop checks `_breaker.open` at the top of each iteration
- [ ] Circuit trip message includes: reason, stats (calls, tokens), and next-step guidance
- [ ] One final model call allowed after circuit opens (graceful wrap-up)
- [ ] All thresholds in `.env` with documented rationale
- [ ] Grafana alert rule configured for `circuit_open` events
- [ ] `test_circuit_breaker.py` passes for: max calls, consecutive same, large payload

## Files involved

| File | Action |
|------|--------|
| `circuit_breaker.py` | Create: `CircuitBreakerConfig`, `CircuitBreakerState` |
| `agent.py` | Wire `_breaker` into `handle_tool()` and `run_agent()` |
| `test_circuit_breaker.py` | Create: threshold tests |
| `.env` | Add `CB_MAX_*` threshold variables |

## Common mistakes

**Shared breaker across tasks** — the `_breaker` must be instantiated fresh at the start of each `run_agent()` call. A module-level singleton carries state from a previous run, making the first task's data distort the second task's thresholds.

**Not allowing a graceful wrap-up** — when the circuit opens mid-loop, allow one final model call with the tool results so far. Without it, the agent stops abruptly and the user sees an error rather than a partial summary of what was accomplished.

**Thresholds too tight for legitimate tasks** — `max_tool_calls=5` will trip on a multi-step research task that legitimately calls `rag_query` 6 times. Calibrate thresholds against real runs before setting production values. Start loose (20-30 calls), observe, then tighten.

**Only checking in handle_tool()** — the circuit also needs a check at the top of the run loop. If the circuit opens due to a large payload after a tool call, the agent will start another LLM call before handle_tool() is invoked again.

**Alerting without actionability** — a Grafana alert that fires but provides no context is noise. Include `agent_id`, `task_id`, `reason`, and the `stats` block in the alert body so the operator knows immediately what happened.
