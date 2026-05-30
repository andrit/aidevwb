---
name: multi-agent-failure-handling
description: Make a multi-agent team resilient to partial failures — per-agent error boundaries, configurable continue-vs-halt policy, retry strategy, structured error output when the team fails, and dead-agent detection
domain: multi-agent
type: multi-agent
triggers:
  - "agent failure"
  - "agent crashed"
  - "partial failure"
  - "team failure"
  - "agent retry"
  - "one agent failed"
  - "continue without agent"
  - "team error handling"
  - "dead agent"
---

# Multi-Agent Failure Handling

## When to use

When a multi-agent team's failure mode is "unhandled exception and the whole team stops." In production, one agent crashing should not always crash the team. Sometimes it should retry; sometimes it should continue without that agent's output; sometimes it should halt cleanly with a structured explanation of what succeeded and what failed. Activate when a team crashes on any agent error, or when designing a team for unsupervised production use.

## Prerequisites

- Multi-agent team with at least 2 agents
- `production-multi-agent-deployment` completed (team_runs table exists)
- Each agent's failure modes understood: which errors are transient, which are fatal

## Failure Mode Classification

Before writing any code, classify each agent's failure modes:

```python
# For each agent in the team, answer:
# 1. What can go wrong? (LLM timeout, tool error, budget exceeded, bad input)
# 2. Is it transient or permanent?
# 3. Can the team proceed without this agent's output?
# 4. What partial output (if any) should be passed on?

AGENT_FAILURE_POLICY = {
    "researcher": {
        "on_transient": "retry",           # network timeout → retry up to 3x
        "on_permanent": "continue",        # bad query → continue with empty sources
        "partial_output_key": "sources",   # pass empty list if this agent fails
    },
    "fact_checker": {
        "on_transient": "retry",
        "on_permanent": "halt",            # cannot proceed without fact checking
        "partial_output_key": None,
    },
    "writer": {
        "on_transient": "retry",
        "on_permanent": "halt",            # final output — cannot skip
        "partial_output_key": None,
    },
}
```

## Step 1 — Per-Agent Error Boundary

Wrap each agent call so its failure is caught and handled according to policy, not propagated immediately.

```python
# agents/lib/error_boundary.py
import asyncio
from dataclasses import dataclass
from typing import Any, Callable, Awaitable
from agents.lib.logging import get_logger

logger = get_logger(__name__)

@dataclass
class AgentResult:
    agent_name:   str
    success:      bool
    output:       Any         # None if failed
    error:        str | None  # None if succeeded
    attempts:     int = 1
    cost_usd:     float = 0.0

async def run_with_boundary(
    agent_name:      str,
    fn:              Callable[[], Awaitable[Any]],
    on_transient:    str = "retry",   # "retry" | "continue" | "halt"
    on_permanent:    str = "halt",    # "continue" | "halt"
    max_retries:     int = 3,
    retry_delay_s:   float = 2.0,
) -> AgentResult:
    """Run an agent function with retry and failure handling."""

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            output = await fn()
            logger.info(f"Agent {agent_name} succeeded", extra={"attempt": attempt})
            return AgentResult(agent_name=agent_name, success=True, output=output, attempts=attempt)

        except BudgetExceededError as e:
            # Budget errors are permanent — no retry
            logger.error(f"Agent {agent_name} budget exceeded", extra={"error": str(e)})
            if on_permanent == "halt":
                raise AgentHaltError(agent_name, str(e)) from e
            return AgentResult(agent_name=agent_name, success=False, output=None,
                               error=str(e), attempts=attempt)

        except Exception as e:
            last_error = e
            is_transient = is_transient_error(e)
            logger.warning(f"Agent {agent_name} failed (attempt {attempt}/{max_retries})",
                           extra={"error": str(e), "transient": is_transient})

            if not is_transient:
                # Permanent error — apply on_permanent policy immediately
                if on_permanent == "halt":
                    raise AgentHaltError(agent_name, str(e)) from e
                return AgentResult(agent_name=agent_name, success=False, output=None,
                                   error=str(e), attempts=attempt)

            if attempt < max_retries:
                await asyncio.sleep(retry_delay_s * attempt)  # backoff
            else:
                # Exhausted retries — apply on_transient policy
                if on_transient == "halt":
                    raise AgentHaltError(agent_name, str(last_error)) from last_error
                return AgentResult(agent_name=agent_name, success=False, output=None,
                                   error=str(last_error), attempts=attempt)

    # Should not reach here
    raise RuntimeError("Unreachable")

def is_transient_error(e: Exception) -> bool:
    msg = str(e).lower()
    return any(t in msg for t in ["timeout", "connection", "rate limit", "503", "overloaded"])

class AgentHaltError(Exception):
    def __init__(self, agent_name: str, reason: str):
        super().__init__(f"Agent '{agent_name}' failed and team must halt: {reason}")
        self.agent_name = agent_name
        self.reason = reason
```

## Step 2 — Structured Team Failure Output

When the team can't complete, return a structured result rather than raising an unhandled exception.

```python
# agents/orchestrator.py
from agents.lib.error_boundary import run_with_boundary, AgentHaltError

async def run_research_team(task: str, run_id: str) -> dict:
    completed_agents = []
    failed_agents = []
    partial_outputs = {}

    # Step 1: Research (continue if fails — empty sources is workable)
    researcher_result = await run_with_boundary(
        "researcher",
        lambda: researcher_agent.run(task),
        on_transient="retry",
        on_permanent="continue",
    )
    if researcher_result.success:
        completed_agents.append("researcher")
        partial_outputs["sources"] = researcher_result.output
    else:
        failed_agents.append("researcher")
        partial_outputs["sources"] = []  # continue with empty sources
        logger.warning("Researcher failed — continuing with empty sources",
                       extra={"run_id": run_id, "error": researcher_result.error})

    # Step 2: Fact check (halt if fails — cannot proceed)
    try:
        fc_result = await run_with_boundary(
            "fact_checker",
            lambda: fact_checker_agent.run(task, partial_outputs["sources"]),
            on_transient="retry",
            on_permanent="halt",
        )
        completed_agents.append("fact_checker")
        partial_outputs["verified_facts"] = fc_result.output
    except AgentHaltError as e:
        # Structured halt — return what we have, explain what failed
        return build_failure_result(
            run_id=run_id,
            task=task,
            reason=str(e),
            completed=completed_agents,
            failed=failed_agents + [e.agent_name],
            partial=partial_outputs,
        )

    # Step 3: Write (halt if fails)
    try:
        writer_result = await run_with_boundary(
            "writer",
            lambda: writer_agent.run(task, partial_outputs),
            on_transient="retry",
            on_permanent="halt",
        )
        completed_agents.append("writer")
        return build_success_result(run_id, task, writer_result.output, completed_agents)

    except AgentHaltError as e:
        return build_failure_result(
            run_id=run_id, task=task, reason=str(e),
            completed=completed_agents, failed=[e.agent_name], partial=partial_outputs,
        )

def build_failure_result(run_id, task, reason, completed, failed, partial) -> dict:
    return {
        "run_id":    run_id,
        "status":    "partial" if completed else "failed",
        "task":      task,
        "reason":    reason,
        "completed": completed,
        "failed":    failed,
        "partial_output": partial,
        "output":    None,
    }

def build_success_result(run_id, task, output, completed) -> dict:
    return {
        "run_id":    run_id,
        "status":    "completed",
        "task":      task,
        "completed": completed,
        "failed":    [],
        "output":    output,
    }
```

## Step 3 — Dead-Agent Detection

Detect agents that stop responding (hung, not crashed):

```python
# agents/lib/watchdog.py
import asyncio
from agents.lib.logging import get_logger

logger = get_logger(__name__)

async def run_with_timeout(
    agent_name: str,
    fn,
    timeout_s: float = 300.0,  # 5 minutes max per agent
) -> Any:
    try:
        return await asyncio.wait_for(fn(), timeout=timeout_s)
    except asyncio.TimeoutError:
        logger.error(f"Agent {agent_name} timed out after {timeout_s}s")
        raise TimeoutError(f"Agent '{agent_name}' did not respond within {timeout_s}s")
```

## Step 4 — Alert on Team Failure

```python
# agents/lib/alerts.py
async def alert_team_failure(run_id: str, result: dict) -> None:
    if result["status"] in ("partial", "failed") and ALERT_WEBHOOK:
        msg = (
            f"⚠️ Multi-agent team run {run_id} ended with status '{result['status']}'\n"
            f"Failed agents: {', '.join(result['failed']) or 'none'}\n"
            f"Completed agents: {', '.join(result['completed'])}\n"
            f"Reason: {result.get('reason', 'unknown')}"
        )
        async with httpx.AsyncClient() as client:
            await client.post(ALERT_WEBHOOK, json={"text": msg})
```

## Checklist

- [ ] `AGENT_FAILURE_POLICY` defined for every agent: transient policy, permanent policy
- [ ] Every agent call wrapped in `run_with_boundary` with explicit policies
- [ ] `is_transient_error()` classifies network/rate errors correctly
- [ ] `AgentHaltError` returns a structured result — never an unhandled exception
- [ ] `partial_output` preserved in the result — what completed is not lost
- [ ] `run_with_timeout` wraps long-running agents
- [ ] `team_runs` table updated with `status='partial'` when one agent fails but team continues
- [ ] Alert sent on `partial` or `failed` team runs
- [ ] Tested: kill one agent mid-run — verify team continues or halts cleanly per policy

## Files involved

| File | Action |
|------|--------|
| `agents/lib/error_boundary.py` | Create: `run_with_boundary`, `AgentHaltError`, `is_transient_error` |
| `agents/lib/watchdog.py` | Create: `run_with_timeout` |
| `agents/lib/alerts.py` | Create/update: `alert_team_failure` |
| `agents/orchestrator.py` | Update: wrap every agent call with boundary + timeout |
| `AGENT_FAILURE_POLICY` | Document in `CLAUDE.md` or a config file |

## Common mistakes

**Retrying permanent errors** — if the researcher agent fails because the task is malformed, retrying will fail the same way every time. Classify errors before applying retry. Permanent errors should trigger the on_permanent policy immediately.

**Losing partial output on halt** — when the team halts, the caller gets an exception and nothing else. Always return a structured result dict that includes what completed successfully. The caller may be able to use partial results.

**Same timeout for all agents** — a writer producing a long essay and a classifier returning a yes/no need very different timeouts. Set per-agent timeouts based on expected work, not a global default.
