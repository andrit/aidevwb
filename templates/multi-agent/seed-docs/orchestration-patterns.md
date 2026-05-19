# Multi-Agent Orchestration Patterns — Reference Guide

## When to Use Multiple Agents

A single agent handles most tasks. Use multiple agents when:
- The task requires distinct expertise (research + writing + review)
- You want independent perspectives before making a decision (consensus)
- The task can be decomposed into parallelizable subtasks (speed)
- You need a manager to dynamically route work based on intermediate results

If a single agent with tools can do the job, don't add complexity with multiple agents. Each agent adds latency, cost, and coordination overhead.

## The Four Patterns

### Sequential: A → B → C

Each agent runs in order. Each agent receives the previous agent's output as additional context.

**When to use:** linear workflows where each step depends on the prior step. Research → synthesis, draft → review, extract → transform → load.

**Strengths:** simple to understand and debug. Each step's input and output are clear. Failures are easy to locate (which step broke?).

**Weaknesses:** slow (total time = sum of all steps). A bad early result cascades through all subsequent steps.

```python
result = await sequential([
    ("researcher", researcher),
    ("writer", writer),
    ("reviewer", reviewer),
], task="Write a technical blog post about our new caching layer")
```

**What the message bus shows:**
```
orchestrator: step_start → researcher
researcher: step_complete → "Found 5 relevant design decisions..."
orchestrator: step_start → writer
writer: step_complete → "# Caching Layer Deep Dive..."
orchestrator: step_start → reviewer
reviewer: step_complete → "Approved with minor edits..."
```

### Parallel: A + B + C → collect

All agents run simultaneously on the same task. Results are collected as a dict.

**When to use:** you want multiple independent perspectives, or the task decomposes into independent subtasks that don't depend on each other.

**Strengths:** fast (total time = slowest agent, not sum). Independent failures don't block others. Good for getting diverse perspectives.

**Weaknesses:** agents can't build on each other's work. Combining results requires a separate step (or use consensus pattern).

```python
results = await parallel([
    ("security_analyst", security_agent),
    ("performance_analyst", perf_agent),
    ("ux_analyst", ux_agent),
], task="Review the proposed API changes in PR #142")
```

### Hierarchical: Manager → Workers → Synthesis

A manager agent receives the task, creates a plan (which worker handles what), dispatches subtasks to workers, then synthesizes the results.

**When to use:** complex tasks where the decomposition itself requires intelligence. The manager decides how to split the work based on the task content, not a fixed pipeline.

**Strengths:** adaptive — the manager can route different tasks differently. Workers specialize. The manager can ask for clarification or reassign if a worker fails.

**Weaknesses:** the manager is a single point of failure. If it creates a bad plan, all worker effort is wasted. More LLM calls (planning + delegation + synthesis).

```python
result = await hierarchical(
    manager=("lead", manager_agent),
    workers=[
        ("backend", backend_agent),
        ("frontend", frontend_agent),
        ("devops", devops_agent),
    ],
    task="Plan the migration from monolith to microservices",
)
```

**What the message bus shows:**
```
orchestrator: hierarchical_start → manager=lead, workers=[backend, frontend, devops]
lead: plan_created → [{"worker":"backend","subtask":"..."}, {"worker":"frontend","subtask":"..."}]
lead: task_delegated → backend: "Design the service boundaries..."
backend: task_complete → "Proposed 4 services: auth, billing, catalog, orders..."
lead: task_delegated → frontend: "Plan the BFF layer..."
frontend: task_complete → "BFF should aggregate..."
lead: synthesis_complete → "Migration plan: Phase 1..."
```

### Consensus: All Respond → Judge Picks Best

All agents respond to the same task independently (parallel), then a judge agent evaluates all responses and picks the best or synthesizes a consensus.

**When to use:** high-stakes decisions where you want to reduce the risk of a single agent's bias or error. The judge acts as a quality gate.

**Strengths:** reduces individual agent errors. The judge can catch hallucinations or weak reasoning by comparing multiple responses. Good for important decisions.

**Weaknesses:** most expensive pattern (N agents + 1 judge). Only useful when the decision matters enough to justify the cost.

```python
result = await consensus(
    agents=[
        ("conservative", conservative_agent),
        ("aggressive", aggressive_agent),
        ("balanced", balanced_agent),
    ],
    task="What should our pricing strategy be for the enterprise tier?",
    judge=("cfo", cfo_agent),
)
```

## Pattern Selection Flowchart

```
Is the task decomposable into independent parts?
  ├── Yes: Do the parts need different expertise?
  │     ├── Yes: → Hierarchical (manager decides who does what)
  │     └── No:  → Parallel (everyone works simultaneously)
  └── No: Does each step depend on the prior step?
        ├── Yes: → Sequential (A → B → C)
        └── No: Do you want multiple perspectives + quality gate?
              ├── Yes: → Consensus (all respond, judge picks)
              └── No:  → Single agent (don't use multi-agent)
```

## Combining Patterns

Patterns compose naturally:

```python
# Parallel research, then sequential writing + review
research_results = await parallel([
    ("paper_searcher", searcher),
    ("code_searcher", code_agent),
], task="Find all references to rate limiting")

synthesis_input = json.dumps(research_results)
final = await sequential([
    ("writer", writer),
    ("reviewer", reviewer),
], task=f"Write a report from these findings:\n{synthesis_input}")
```

## Monitoring Multi-Agent Systems

All patterns publish to the workbench message bus. Use these tools:

```
bus_channels                     → see all active communication channels
bus_read("orchestration")        → see the coordination log
bus_read("orchestration", since_id=42) → poll for new messages
```

In Grafana (Agent Trace Viewer):
- Filter by `workbench.category=agent` to see tool calls per agent
- Filter by `bus.channel=orchestration` to see coordination messages
- Look for `event=parallel_error` or `event=step_complete` to track progress

## Cost Considerations

Each agent call is an LLM call. Multi-agent systems multiply costs:

| Pattern | LLM Calls | When cost is justified |
|---------|-----------|----------------------|
| Sequential (3 agents) | 3 | Each step adds distinct value |
| Parallel (3 agents) | 3 | Speed matters, tasks are independent |
| Hierarchical (1 + 3 workers) | 5+ | Task decomposition needs intelligence |
| Consensus (3 + judge) | 4 | Decision stakes justify redundancy |

Use cheaper models for workers when possible. Reserve the expensive model for the manager/judge/synthesizer.
