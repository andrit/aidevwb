# Phase 3A-4 Report — Orchestration Patterns

## What Was Built

Phase 3A-4 delivers a reusable Python patterns library and a multi-agent project type scaffold. The patterns library provides four coordination strategies for multi-agent systems, built on the workbench message bus. The multi-agent scaffold generates a working project with all four patterns wired up and ready to run.

Three deliverables:

1. **Patterns library** (`patterns.py`) — four orchestration strategies as composable async functions
2. **Multi-agent scaffold** — project template with agents, patterns, Dockerfile, docker-compose
3. **Orchestration seed doc** — when to use which pattern, cost analysis, composition examples

## The Four Patterns

### Sequential: A → B → C

Each agent runs in order. Each receives the previous agent's output as context, building on prior work.

```python
result = await sequential([
    ("researcher", researcher),
    ("writer", writer),
], task="Analyze our error handling patterns")
```

**Use when:** work is inherently linear — research → synthesis, draft → review, extract → transform.

### Parallel: A + B + C → collect

All agents run simultaneously on the same task. Results are returned as a dict keyed by agent name.

```python
results = await parallel([
    ("security", security_agent),
    ("performance", perf_agent),
], task="Review the proposed API changes")
```

**Use when:** you want independent perspectives, or the task decomposes into non-dependent subtasks. Total time = slowest agent, not sum.

### Hierarchical: Manager → Workers → Synthesis

A manager agent creates a plan (JSON array of subtask assignments), workers execute their assigned subtasks, then the manager synthesizes all results.

```python
result = await hierarchical(
    manager=("lead", manager_agent),
    workers=[("backend", backend_agent), ("frontend", frontend_agent)],
    task="Plan the migration to microservices",
)
```

**Use when:** the task decomposition itself requires intelligence. The manager dynamically routes work based on the task content.

### Consensus: All Respond → Judge Picks Best

All agents respond independently (parallel), then a judge agent evaluates all responses and picks the best or synthesizes a consensus answer.

```python
result = await consensus(
    agents=[("conservative", agent_a), ("aggressive", agent_b)],
    task="What should our pricing strategy be?",
    judge=("cfo", cfo_agent),
)
```

**Use when:** stakes are high enough to justify the cost of multiple responses + evaluation. Reduces risk of single-agent bias.

## Design Decisions

### Agents as Async Callables

Every pattern takes agents as `list[tuple[str, Agent]]` where `Agent = Callable[[str], Awaitable[str]]`. This is the simplest possible interface — a function that takes a task string and returns a result string. Any agent implementation works:

- A Claude API call with tools (the scaffold's `make_agent()`)
- An AutoGen AssistantAgent wrapped in an async function
- A CrewAI crew with a single task
- A LangGraph compiled graph
- A mock function for testing

The patterns library doesn't know or care what's inside the agent function.

### Message Bus for Observability, Not Coordination

The patterns don't *require* the message bus to function — they'd work fine with just `await agent_fn(task)`. The bus is optional (pass `bus=None` to skip). When provided, it publishes coordination events (step_start, step_complete, plan_created, task_delegated, etc.) to the `orchestration` channel.

This means you can:
- Watch the coordination in real-time via `bus_read("orchestration")`
- See it in the Agent Trace Viewer dashboard
- Debug why a hierarchical delegation went wrong
- Measure time per step

### WorkbenchBus Client Class

The patterns library includes a `WorkbenchBus` class that wraps the workbench HTTP API. It handles project scoping, publish/read, and memory access. This is the only dependency on the workbench — replace it with a mock and the patterns work offline.

```python
bus = WorkbenchBus(project="nexus", api_url="http://mcp-server:3100")
bus.publish("channel", "sender", {"data": "value"})
messages = bus.read("channel", since_id=0)
bus.remember("key", "value")
value = bus.recall("key")
```

### Patterns Compose

Patterns are functions that return strings. You can chain them:

```python
# Parallel research, then sequential writing + review
research = await parallel([...], task)
final = await sequential([...], task=f"From these findings:\n{json.dumps(research)}")
```

## Multi-Agent Project Type

`make scaffold NAME=my-team TYPE=multi-agent` generates:

```
~/code/my-team/
├── .workbench/project.json     ← type: multi-agent, all MCP tools + bus
├── CLAUDE.md                   ← dev roadmap for multi-agent projects
├── documents/                  ← RAG source files
├── main.py                     ← entry point with all 4 patterns wired up
├── patterns.py                 ← orchestration patterns library (copied)
├── requirements.txt            ← anthropic, httpx, OTel
├── Dockerfile                  ← container for the agent team
└── docker-compose.yml          ← connects to workbench network
```

The `main.py` defines five agents (researcher, writer, analyst, manager, judge) and maps them to the four patterns via a CLI:

```bash
python main.py sequential "Analyze our API error handling"
python main.py parallel "What are the key deployment risks?"
python main.py hierarchical "Create a test plan for the auth module"
python main.py consensus "Best caching strategy for our API?"
```

## Files Created

### Templates

| File | Purpose |
|------|---------|
| `templates/agent/patterns/patterns.py` | Reusable orchestration patterns library |
| `templates/multi-agent/project.json` | Multi-agent type config (all tools + bus) |
| `templates/multi-agent/scaffold/main.py` | Working entry point with 5 agents + 4 patterns |
| `templates/multi-agent/scaffold/patterns.py` | Patterns library (copied from agent/patterns/) |
| `templates/multi-agent/scaffold/requirements.txt` | Python dependencies |
| `templates/multi-agent/scaffold/Dockerfile` | Container image |
| `templates/multi-agent/scaffold/docker-compose.yml` | Runs on workbench network |
| `templates/multi-agent/seed-docs/orchestration-patterns.md` | Pattern guide: selection flowchart, cost analysis, composition |

### Source Code

| File | Change |
|------|--------|
| `src/services/scaffold.ts` | Added `copyTypeScaffold()` for multi-agent scaffold handling |

### Design Note

| File | Purpose |
|------|---------|
| `docs/design-note-four-skills.md` | Assessment of RAG, evals, agents, deployment — gap analysis + priorities |

## Test Results

```
 Test Files  10 passed (10)
      Tests  107 passed (107)
```

No new test files in this phase — the patterns library is Python (tested when run), and the scaffold service changes reuse the existing `copyTypeScaffold` pattern. The schema already included `multi-agent` in the type enum.

## User Interfaces

### Makefile

```bash
# Scaffold a multi-agent project
make scaffold NAME=my-team TYPE=multi-agent
```

### REST API

```bash
POST /scaffold
{"name": "my-team", "directory": "/workspace/my-team", "type": "multi-agent"}
```

### Running the Scaffolded Project

```bash
# From the project directory
pip install -r requirements.txt
python main.py sequential "Your task here"

# Or via Docker (connected to workbench network)
docker compose run agent sequential "Your task here"
docker compose run agent hierarchical "Your task here"
```

### Monitoring via Message Bus

```bash
# Watch orchestration events in real-time
curl -N http://localhost:3100/bus/orchestration/stream -H "X-Project: my-team"

# Or via MCP tool
bus_read("orchestration")
```

## What's Next

Remaining Phase 3A items:
- **Phase 3A-5:** Step-through debugging — pause/inspect/approve agent actions before execution

Deferred (per design note):
- **Agent eval framework** — behavioral testing for agent decisions (highest-impact remaining item, to revisit after current workflow completes)
