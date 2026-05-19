"""
Orchestration Patterns — reusable multi-agent coordination.

Framework-agnostic. Agents are callables that take a task (string)
and return a result (string). Coordination happens via the workbench
message bus (HTTP). Any agent implementation works — AutoGen, CrewAI,
LangGraph, or a plain function.

Patterns:
  sequential(agents, task)    — A → B → C, each sees prior output
  parallel(agents, task)      — A + B + C simultaneously, results collected
  hierarchical(manager, workers, task) — manager delegates, workers execute
  consensus(agents, task, judge) — all agents respond, judge picks the best

Usage:
  from patterns import sequential, WorkbenchBus

  bus = WorkbenchBus(project="my-project")

  async def researcher(task: str) -> str:
      # ... your agent logic ...
      return findings

  async def writer(task: str) -> str:
      # ... your agent logic ...
      return summary

  result = await sequential([researcher, writer], "Analyze Q3 revenue")
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, Callable, Awaitable

import httpx

# Type alias: an agent is an async function that takes a task string and returns a result string
Agent = Callable[[str], Awaitable[str]]


class WorkbenchBus:
    """Client for the workbench message bus API."""

    def __init__(
        self,
        project: str | None = None,
        api_url: str | None = None,
    ):
        self.project = project or os.environ.get("WORKBENCH_PROJECT", "default")
        self.api_url = api_url or os.environ.get("WORKBENCH_API", "http://mcp-server:3100")
        self.http = httpx.Client(
            base_url=self.api_url,
            headers={"X-Project": self.project},
            timeout=30.0,
        )

    def publish(self, channel: str, sender: str, content: Any) -> dict:
        resp = self.http.post("/bus/publish", json={
            "channel": channel, "sender": sender, "content": content,
        })
        return resp.json()

    def read(self, channel: str, since_id: int = 0, limit: int = 50) -> list[dict]:
        resp = self.http.post("/bus/read", json={
            "channel": channel, "since_id": since_id, "limit": limit,
        })
        return resp.json().get("messages", [])

    def remember(self, key: str, value: Any) -> None:
        self.http.put(f"/memory/{key}", json={"value": value})

    def recall(self, key: str) -> Any | None:
        resp = self.http.get(f"/memory/{key}")
        if resp.status_code == 404:
            return None
        return resp.json().get("value")

    def debug_hold(
        self,
        agent: str,
        tool: str,
        args: dict,
        context: str = "",
        timeout: int = 300,
    ) -> dict:
        """
        Submit a tool call for approval. Blocks until approved or rejected.
        Returns {"decision": "approved"|"rejected", "reason": "..."}.
        Only blocks if debug mode is enabled for the project.
        """
        resp = self.http.post("/debug/hold", json={
            "agent": agent,
            "tool": tool,
            "args": args,
            "context": context,
            "timeout": timeout,
        })
        return resp.json()

    def close(self):
        self.http.close()


# ═══════════════════════════════════════════════════════════
# Pattern 1: Sequential
# A → B → C
# Each agent receives the previous agent's output as context.
# ═══════════════════════════════════════════════════════════

async def sequential(
    agents: list[tuple[str, Agent]],
    task: str,
    bus: WorkbenchBus | None = None,
    channel: str = "orchestration",
) -> str:
    """
    Run agents in sequence. Each agent's output becomes the next agent's input.

    Args:
        agents: list of (name, agent_fn) tuples
        task: initial task description
        bus: optional WorkbenchBus for logging (publishes each step)
        channel: bus channel for logging

    Returns:
        Final agent's output
    """
    current_input = task

    for i, (name, agent_fn) in enumerate(agents):
        if bus:
            bus.publish(channel, "orchestrator", {
                "event": "step_start",
                "step": i + 1,
                "agent": name,
                "input_preview": current_input[:200],
            })

        result = await agent_fn(current_input)

        if bus:
            bus.publish(channel, name, {
                "event": "step_complete",
                "step": i + 1,
                "output_preview": result[:200],
            })

        # Next agent gets this agent's output as additional context
        current_input = (
            f"Original task: {task}\n\n"
            f"Previous agent ({name}) output:\n{result}\n\n"
            f"Continue with your role."
        )

    return result


# ═══════════════════════════════════════════════════════════
# Pattern 2: Parallel
# A + B + C → collect all results
# All agents run simultaneously on the same task.
# ═══════════════════════════════════════════════════════════

async def parallel(
    agents: list[tuple[str, Agent]],
    task: str,
    bus: WorkbenchBus | None = None,
    channel: str = "orchestration",
) -> dict[str, str]:
    """
    Run all agents simultaneously on the same task.

    Args:
        agents: list of (name, agent_fn) tuples
        task: task description (same for all agents)
        bus: optional WorkbenchBus for logging

    Returns:
        dict mapping agent name → result
    """
    if bus:
        bus.publish(channel, "orchestrator", {
            "event": "parallel_start",
            "agents": [name for name, _ in agents],
            "task_preview": task[:200],
        })

    async def run_one(name: str, agent_fn: Agent) -> tuple[str, str]:
        try:
            result = await agent_fn(task)
            if bus:
                bus.publish(channel, name, {
                    "event": "parallel_complete",
                    "output_preview": result[:200],
                })
            return name, result
        except Exception as e:
            if bus:
                bus.publish(channel, name, {
                    "event": "parallel_error",
                    "error": str(e),
                })
            return name, f"Error: {e}"

    results = await asyncio.gather(
        *[run_one(name, fn) for name, fn in agents]
    )

    return dict(results)


# ═══════════════════════════════════════════════════════════
# Pattern 3: Hierarchical
# Manager delegates tasks to workers, collects results.
# The manager decides which worker handles what.
# ═══════════════════════════════════════════════════════════

async def hierarchical(
    manager: tuple[str, Agent],
    workers: list[tuple[str, Agent]],
    task: str,
    bus: WorkbenchBus | None = None,
    channel: str = "orchestration",
    max_rounds: int = 5,
) -> str:
    """
    Manager delegates subtasks to workers, collects results, and synthesizes.

    The manager agent receives the task and a list of available workers.
    It returns a JSON plan: [{"worker": "name", "subtask": "description"}, ...]
    Workers execute their subtasks. The manager then synthesizes the results.

    Args:
        manager: (name, agent_fn) — the coordinating agent
        workers: list of (name, agent_fn) — available workers
        task: overall task description
        max_rounds: safety limit on delegation rounds

    Returns:
        Manager's final synthesized output
    """
    manager_name, manager_fn = manager
    worker_map = dict(workers)
    worker_descriptions = ", ".join(f"'{name}'" for name in worker_map)

    if bus:
        bus.publish(channel, "orchestrator", {
            "event": "hierarchical_start",
            "manager": manager_name,
            "workers": list(worker_map.keys()),
        })

    # Step 1: Manager creates a plan
    plan_prompt = (
        f"Task: {task}\n\n"
        f"You are the manager. Available workers: {worker_descriptions}.\n"
        f"Create a plan by responding with a JSON array of subtasks:\n"
        f'[{{"worker": "worker_name", "subtask": "what they should do"}}]\n'
        f"Only use worker names from the available list."
    )

    plan_raw = await manager_fn(plan_prompt)

    if bus:
        bus.publish(channel, manager_name, {
            "event": "plan_created",
            "plan_preview": plan_raw[:500],
        })

    # Parse the plan (extract JSON from the response)
    try:
        # Find JSON array in the response
        start = plan_raw.index("[")
        end = plan_raw.rindex("]") + 1
        plan = json.loads(plan_raw[start:end])
    except (ValueError, json.JSONDecodeError):
        # If manager didn't return valid JSON, treat entire response as a single task
        plan = [{"worker": list(worker_map.keys())[0], "subtask": task}]

    # Step 2: Dispatch subtasks to workers
    worker_results: dict[str, str] = {}
    for assignment in plan:
        worker_name = assignment.get("worker", "")
        subtask = assignment.get("subtask", "")

        if worker_name not in worker_map:
            worker_results[worker_name] = f"Error: unknown worker '{worker_name}'"
            continue

        if bus:
            bus.publish(channel, manager_name, {
                "event": "task_delegated",
                "worker": worker_name,
                "subtask_preview": subtask[:200],
            })

        result = await worker_map[worker_name](subtask)
        worker_results[worker_name] = result

        if bus:
            bus.publish(channel, worker_name, {
                "event": "task_complete",
                "output_preview": result[:200],
            })

    # Step 3: Manager synthesizes results
    synthesis_prompt = (
        f"Original task: {task}\n\n"
        f"Worker results:\n"
        + "\n".join(f"- {name}: {result[:500]}" for name, result in worker_results.items())
        + "\n\nSynthesize these results into a final answer."
    )

    final = await manager_fn(synthesis_prompt)

    if bus:
        bus.publish(channel, manager_name, {
            "event": "synthesis_complete",
            "output_preview": final[:200],
        })

    return final


# ═══════════════════════════════════════════════════════════
# Pattern 4: Consensus
# All agents respond independently, then a judge picks the best
# or synthesizes a consensus answer.
# ═══════════════════════════════════════════════════════════

async def consensus(
    agents: list[tuple[str, Agent]],
    task: str,
    judge: tuple[str, Agent],
    bus: WorkbenchBus | None = None,
    channel: str = "orchestration",
) -> str:
    """
    All agents respond to the same task independently.
    A judge agent evaluates all responses and picks or synthesizes the best.

    Args:
        agents: list of (name, agent_fn) — respondents
        task: task description
        judge: (name, agent_fn) — evaluates and picks the winner
        bus: optional WorkbenchBus for logging

    Returns:
        Judge's selected or synthesized answer
    """
    # Step 1: Get all responses in parallel
    responses = await parallel(agents, task, bus, channel)

    if bus:
        bus.publish(channel, "orchestrator", {
            "event": "consensus_judging",
            "response_count": len(responses),
        })

    # Step 2: Judge evaluates
    judge_name, judge_fn = judge
    judge_prompt = (
        f"Task: {task}\n\n"
        f"Multiple agents have responded. Evaluate their answers and "
        f"either pick the best one or synthesize a consensus answer.\n\n"
        + "\n".join(
            f"--- {name} ---\n{response}\n"
            for name, response in responses.items()
        )
        + "\nProvide your final answer."
    )

    verdict = await judge_fn(judge_prompt)

    if bus:
        bus.publish(channel, judge_name, {
            "event": "verdict",
            "output_preview": verdict[:200],
        })

    return verdict
