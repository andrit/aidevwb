---
name: llm-cost-and-rate-management
description: Add per-task token budgets, cost estimation, spend tracking, and rate limiting to an agent — prevent runaway loops from causing surprise bills and add alerting on cost spikes
domain: agent
type: agent
triggers:
  - "token budget"
  - "cost control"
  - "LLM cost"
  - "rate limit"
  - "runaway loop"
  - "spend tracking"
  - "cost spike"
  - "token tracking"
  - "Claude cost"
  - "API spend"
---

# LLM Cost and Rate Management

## When to use

Before any agent runs unsupervised in production. An agent that enters an unexpected loop can make hundreds of API calls before anyone notices. At production rates, a 100-turn loop costs $5–50 depending on the model. This skill adds hard token budgets per task, soft cost alerts, and rate limiting that prevents runaway agents from causing surprise charges. Activate when deploying an agent, when a cost spike was observed, or when the user asks "how do I control LLM costs?"

## Prerequisites

- Agent using the Anthropic Python SDK
- Production deployment (or staging that will run unsupervised)
- An alerting channel (email, Slack webhook, or PagerDuty)

## Anthropic Pricing Reference (as of training cutoff — verify current at console.anthropic.com)

| Model | Input (per M tokens) | Output (per M tokens) |
|-------|---------------------|----------------------|
| claude-opus-4-7 | ~$15 | ~$75 |
| claude-sonnet-4-6 | ~$3 | ~$15 |
| claude-haiku-4-5 | ~$0.80 | ~$4 |

Always use `claude-haiku-4-5-*` for classification, routing, and short decisions. Reserve Sonnet/Opus for the steps that actually need reasoning depth.

## Step 1 — Per-Task Token Budget

Hard-stop the agent when it exceeds the allocated tokens for a single task.

```python
# agent/lib/budget.py
import anthropic
from dataclasses import dataclass, field
from agent.lib.logging import get_logger

logger = get_logger(__name__)

@dataclass
class TokenBudget:
    task_id:           str
    max_input_tokens:  int = 50_000   # input tokens across entire task
    max_output_tokens: int = 10_000   # output tokens across entire task
    max_turns:         int = 20       # hard cap on tool-use turns

    # Tracked during the task
    input_tokens_used:  int = 0
    output_tokens_used: int = 0
    turns_used:         int = 0

    def record_usage(self, usage: anthropic.types.Usage) -> None:
        self.input_tokens_used  += usage.input_tokens
        self.output_tokens_used += usage.output_tokens
        self.turns_used         += 1

    def check(self) -> None:
        """Raise BudgetExceededError if any limit is breached."""
        if self.input_tokens_used > self.max_input_tokens:
            raise BudgetExceededError(
                f"Input token budget exceeded: {self.input_tokens_used}/{self.max_input_tokens}"
            )
        if self.output_tokens_used > self.max_output_tokens:
            raise BudgetExceededError(
                f"Output token budget exceeded: {self.output_tokens_used}/{self.max_output_tokens}"
            )
        if self.turns_used > self.max_turns:
            raise BudgetExceededError(
                f"Max turns exceeded: {self.turns_used}/{self.max_turns}"
            )

    @property
    def estimated_cost_usd(self) -> float:
        # Sonnet-4-6 rates — update for your model
        input_cost  = (self.input_tokens_used  / 1_000_000) * 3.00
        output_cost = (self.output_tokens_used / 1_000_000) * 15.00
        return input_cost + output_cost

class BudgetExceededError(Exception):
    pass
```

## Step 2 — Wire the Budget into the Agent Loop

```python
# agent/run.py
import anthropic
from agent.lib.budget import TokenBudget, BudgetExceededError
from agent.lib.logging import get_logger

logger = get_logger(__name__)
client = anthropic.Anthropic()

async def run_task(task_id: str, prompt: str, model: str = "claude-sonnet-4-6") -> dict:
    budget = TokenBudget(
        task_id=task_id,
        max_input_tokens=100_000,
        max_output_tokens=20_000,
        max_turns=30,
    )
    messages = [{"role": "user", "content": prompt}]

    try:
        while True:
            response = client.messages.create(
                model=model,
                max_tokens=4096,
                messages=messages,
                tools=TOOLS,
            )

            # Record usage BEFORE checking budget
            budget.record_usage(response.usage)

            logger.info("LLM call complete", extra={
                "task_id":    task_id,
                "turn":       budget.turns_used,
                "input_tok":  response.usage.input_tokens,
                "output_tok": response.usage.output_tokens,
                "total_cost": f"${budget.estimated_cost_usd:.4f}",
            })

            # Check budget after every turn
            budget.check()

            if response.stop_reason == "end_turn":
                return {
                    "result":     extract_text(response),
                    "task_id":    task_id,
                    "turns":      budget.turns_used,
                    "input_tok":  budget.input_tokens_used,
                    "output_tok": budget.output_tokens_used,
                    "cost_usd":   budget.estimated_cost_usd,
                }

            # Handle tool calls
            messages = process_tool_calls(response, messages)

    except BudgetExceededError as e:
        logger.warning("Task halted: budget exceeded", extra={
            "task_id":  task_id,
            "reason":   str(e),
            "cost_usd": budget.estimated_cost_usd,
        })
        await record_task_result(task_id, status="budget_exceeded", budget=budget)
        raise
```

## Step 3 — Persist Spend Per Task

```sql
-- supabase/migrations/014_agent_costs.sql
CREATE TABLE agent_task_costs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       TEXT NOT NULL UNIQUE,
  model         TEXT NOT NULL,
  input_tokens  INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  turns         INT NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(10, 6) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,  -- completed, budget_exceeded, error
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX ON agent_task_costs(started_at DESC);
CREATE INDEX ON agent_task_costs(status);
```

```python
# agent/lib/cost_tracker.py
import httpx
import os

WORKBENCH_API = os.environ["WORKBENCH_API"]

async def record_task_result(
    task_id: str, status: str, budget: "TokenBudget"
) -> None:
    # Store in your project's own DB or via the workbench API
    async with httpx.AsyncClient() as client:
        await client.post(f"{WORKBENCH_API}/agent/costs", json={
            "task_id":      task_id,
            "input_tokens": budget.input_tokens_used,
            "output_tokens": budget.output_tokens_used,
            "turns":        budget.turns_used,
            "cost_usd":     budget.estimated_cost_usd,
            "status":       status,
        })
```

## Step 4 — Daily Spend Alert

```python
# agent/lib/spend_alert.py
import httpx
import os
from agent.lib.logging import get_logger

logger = get_logger(__name__)

DAILY_ALERT_THRESHOLD_USD = float(os.environ.get("DAILY_SPEND_ALERT_USD", "10.0"))
ALERT_WEBHOOK = os.environ.get("ALERT_WEBHOOK_URL")

async def check_daily_spend(db) -> None:
    """Call once per hour via a cron task."""
    row = await db.fetchrow(
        """SELECT SUM(cost_usd) as total
           FROM agent_task_costs
           WHERE started_at > NOW() - INTERVAL '24 hours'"""
    )
    total = float(row["total"] or 0)

    logger.info("Daily spend check", extra={"total_usd": total, "threshold": DAILY_ALERT_THRESHOLD_USD})

    if total > DAILY_ALERT_THRESHOLD_USD and ALERT_WEBHOOK:
        async with httpx.AsyncClient() as client:
            await client.post(ALERT_WEBHOOK, json={
                "text": f"⚠️ Agent daily spend ${total:.2f} exceeds threshold ${DAILY_ALERT_THRESHOLD_USD:.2f}"
            })
```

## Step 5 — Rate Limit Concurrent Tasks

```python
# agent/lib/concurrency.py
import asyncio
import os

# Limit concurrent agent tasks — prevents thundering herd on the Anthropic API
MAX_CONCURRENT_TASKS = int(os.environ.get("MAX_CONCURRENT_TASKS", "3"))
_semaphore = asyncio.Semaphore(MAX_CONCURRENT_TASKS)

async def run_task_with_limit(task_id: str, prompt: str) -> dict:
    async with _semaphore:
        return await run_task(task_id, prompt)
```

## Monitoring Queries

```sql
-- Cost by model and day
SELECT DATE(started_at) as day, model,
       COUNT(*) as tasks,
       SUM(input_tokens) as total_input_tok,
       SUM(output_tokens) as total_output_tok,
       SUM(cost_usd) as total_cost_usd,
       AVG(turns) as avg_turns
FROM agent_task_costs
GROUP BY DATE(started_at), model
ORDER BY day DESC;

-- Most expensive tasks (investigate these)
SELECT task_id, model, turns, input_tokens, output_tokens, cost_usd, status, started_at
FROM agent_task_costs
ORDER BY cost_usd DESC
LIMIT 20;

-- Budget exceeded rate
SELECT
  COUNT(*) FILTER (WHERE status='budget_exceeded') as exceeded,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status='budget_exceeded') / COUNT(*), 1) as exceeded_pct
FROM agent_task_costs
WHERE started_at > NOW() - INTERVAL '7 days';
```

## Checklist

- [ ] `TokenBudget` wired into agent loop — checked after every LLM call
- [ ] `max_turns` set (suggest 20–30 for most tasks; never unlimited)
- [ ] Token and cost logged on every turn (queryable in aggregator)
- [ ] `agent_task_costs` table records every task outcome
- [ ] Daily spend alert threshold set in `DAILY_SPEND_ALERT_USD` env var
- [ ] Alert webhook configured and tested
- [ ] `MAX_CONCURRENT_TASKS` semaphore prevents thundering herd
- [ ] Haiku used for classification/routing steps; Sonnet only for reasoning steps
- [ ] Budget exceeded tasks return a structured error (not a silent failure)

## Files involved

| File | Action |
|------|--------|
| `agent/lib/budget.py` | Create: `TokenBudget`, `BudgetExceededError` |
| `agent/lib/cost_tracker.py` | Create: `record_task_result` |
| `agent/lib/spend_alert.py` | Create: `check_daily_spend` |
| `agent/lib/concurrency.py` | Create: concurrency semaphore |
| `agent/run.py` | Update: wire budget into agent loop |
| `supabase/migrations/014_agent_costs.sql` | Create: `agent_task_costs` table |
| `.env.example` | Update: `DAILY_SPEND_ALERT_USD`, `MAX_CONCURRENT_TASKS`, `ALERT_WEBHOOK_URL` |

## Common mistakes

**Setting `max_tokens` per turn but no total budget** — `max_tokens=4096` limits a single response, not the total across a 30-turn conversation. The `TokenBudget` class tracks cumulative usage. Both are needed.

**Not logging cost per turn** — cost surprises happen because nobody knew the task was taking 50 turns. Log `turns_used` and `estimated_cost_usd` on every turn so the runup is visible before it becomes a problem.

**One global semaphore for all task types** — a long-running analysis task and a quick classification task shouldn't share the same concurrency limit. Use separate semaphores for different task types, or use a priority queue.
