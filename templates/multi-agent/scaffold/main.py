"""
{{PROJECT_NAME}} — Multi-Agent System

A team of agents coordinated via orchestration patterns.
Uses the workbench message bus for inter-agent communication
and the patterns library for coordination logic.

Usage:
  # Sequential: researcher → writer
  python main.py sequential "Analyze our API error handling patterns"

  # Parallel: multiple analysts simultaneously
  python main.py parallel "What are the key risks in our deployment pipeline?"

  # Hierarchical: manager delegates to specialists
  python main.py hierarchical "Create a comprehensive test plan for the auth module"

  # Consensus: multiple agents respond, judge picks the best
  python main.py consensus "What's the best caching strategy for our API?"

Customize:
  - Add/modify agents in the agents section below
  - Change system prompts to define each agent's role
  - Add tools (RAG, memory) to individual agents
  - Adjust orchestration parameters
"""
import asyncio
import os
import sys

import anthropic
import httpx
from dotenv import load_dotenv

from patterns import (
    sequential,
    parallel,
    hierarchical,
    consensus,
    WorkbenchBus,
    Agent,
)

load_dotenv()

# ── Configuration ─────────────────────────────────────────

WORKBENCH_API = os.environ.get("WORKBENCH_API", "http://localhost:3100")
WORKBENCH_PROJECT = os.environ.get("WORKBENCH_PROJECT", "{{PROJECT_NAME}}")
MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
bus = WorkbenchBus(project=WORKBENCH_PROJECT, api_url=WORKBENCH_API)

http = httpx.Client(
    base_url=WORKBENCH_API,
    headers={"X-Project": WORKBENCH_PROJECT},
    timeout=30.0,
)

# ── Shared Tools ──────────────────────────────────────────


def rag_search(question: str) -> str:
    """Search the project knowledgebase."""
    resp = http.post("/query", json={"question": question, "top_k": 5})
    return resp.json().get("answer", "No results found.")


# ── Agent Factory ─────────────────────────────────────────


def make_agent(name: str, system_prompt: str, tools: list | None = None) -> Agent:
    """
    Create an agent function from a system prompt.
    Each agent is a thin wrapper around a Claude API call.
    The system prompt defines the agent's role and behavior.
    """
    tool_defs = []
    tool_handlers = {}

    if tools and "rag" in tools:
        tool_defs.append({
            "name": "search_docs",
            "description": "Search the project knowledgebase for relevant information.",
            "input_schema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        })
        tool_handlers["search_docs"] = lambda args: rag_search(args["query"])

    async def agent_fn(task: str) -> str:
        messages = [{"role": "user", "content": task}]

        for _ in range(5):  # max tool rounds
            kwargs: dict = {
                "model": MODEL,
                "max_tokens": 2048,
                "system": system_prompt,
                "messages": messages,
            }
            if tool_defs:
                kwargs["tools"] = tool_defs

            response = client.messages.create(**kwargs)

            tool_calls = [b for b in response.content if b.type == "tool_use"]
            if not tool_calls:
                return "".join(b.text for b in response.content if b.type == "text")

            messages.append({"role": "assistant", "content": response.content})
            tool_results = []
            for tc in tool_calls:
                handler = tool_handlers.get(tc.name)
                result = handler(tc.input) if handler else f"Unknown tool: {tc.name}"
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tc.id,
                    "content": result,
                })
            messages.append({"role": "user", "content": tool_results})

        return "Agent reached maximum tool rounds."

    return agent_fn


# ── Define Your Agents ────────────────────────────────────

researcher = make_agent(
    "researcher",
    "You are a thorough researcher. Search the knowledgebase for relevant "
    "information. Cite your sources. Focus on accuracy over speed.",
    tools=["rag"],
)

writer = make_agent(
    "writer",
    "You are a clear, concise technical writer. Take research findings "
    "and synthesize them into well-structured summaries. "
    "Use bullet points for key findings. Keep it actionable.",
)

analyst = make_agent(
    "analyst",
    "You are a critical analyst. Evaluate information for gaps, risks, "
    "and opportunities. Always consider what might go wrong.",
    tools=["rag"],
)

manager = make_agent(
    "manager",
    "You are a project manager coordinating a team. "
    "When given a task and a list of available workers, create a plan "
    "by assigning subtasks to the right workers. "
    "When given worker results, synthesize them into a coherent final deliverable. "
    "Respond with JSON when creating plans.",
)

judge = make_agent(
    "judge",
    "You are an impartial evaluator. Given multiple responses to the same question, "
    "evaluate each for accuracy, completeness, and clarity. "
    "Either pick the best one or synthesize a consensus answer that combines "
    "the strengths of all responses.",
)

# ── Named Agent Teams ────────────────────────────────────

TEAMS = {
    "sequential": ([("researcher", researcher), ("writer", writer)], {}),
    "parallel": ([("researcher", researcher), ("analyst", analyst)], {}),
    "hierarchical": (
        [],
        {"manager": ("manager", manager), "workers": [("researcher", researcher), ("analyst", analyst), ("writer", writer)]},
    ),
    "consensus": (
        [("researcher", researcher), ("analyst", analyst)],
        {"judge": ("judge", judge)},
    ),
}


# ── Main ──────────────────────────────────────────────────


async def main(pattern_name: str, task: str):
    print(f"\n{'='*60}")
    print(f"Pattern: {pattern_name}")
    print(f"Task: {task}")
    print(f"{'='*60}\n")

    if pattern_name == "sequential":
        agents, _ = TEAMS["sequential"]
        result = await sequential(agents, task, bus=bus)

    elif pattern_name == "parallel":
        agents, _ = TEAMS["parallel"]
        results = await parallel(agents, task, bus=bus)
        result = "\n\n".join(f"--- {name} ---\n{output}" for name, output in results.items())

    elif pattern_name == "hierarchical":
        _, kwargs = TEAMS["hierarchical"]
        result = await hierarchical(
            kwargs["manager"], kwargs["workers"], task, bus=bus
        )

    elif pattern_name == "consensus":
        agents, kwargs = TEAMS["consensus"]
        result = await consensus(agents, task, judge=kwargs["judge"], bus=bus)

    else:
        print(f"Unknown pattern: {pattern_name}")
        print("Available: sequential, parallel, hierarchical, consensus")
        sys.exit(1)

    print(f"\n{'='*60}")
    print("RESULT:")
    print(f"{'='*60}")
    print(result)

    bus.close()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python main.py <pattern> 'your task'")
        print("Patterns: sequential, parallel, hierarchical, consensus")
        sys.exit(1)

    asyncio.run(main(sys.argv[1], sys.argv[2]))
