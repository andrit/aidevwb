---
name: switch-orchestration-pattern
description: Evaluate the current orchestration pattern, choose a better one, migrate main.py, and verify the team still produces correct output
domain: multi-agent
type: multi-agent
triggers:
  - "switch orchestration pattern"
  - "change the pattern"
  - "migrate from sequential to hierarchical"
  - "the agents should run in parallel"
  - "sequential is too slow"
  - "the manager should delegate"
  - "switch to consensus"
  - "change how the agents coordinate"
---

# Switch Orchestration Pattern

## When to use

When the current coordination pattern no longer fits the task — the pipeline is too slow, the output quality is wrong, or the team structure has changed. Activate when the user says "run the agents in parallel", "switch to hierarchical", "the sequential approach is too slow", or "I want a manager to delegate to specialists".

## Prerequisites

- Working multi-agent team in `main.py` with at least two agent functions
- Workbench running: `make up`
- The team has been tested with the current pattern at least once

## Pattern Reference

| Pattern | Shape | Best for | Tradeoffs |
|---------|-------|----------|-----------|
| **sequential** | A → B → C | Tasks where each step needs the previous output | Simple, predictable; as slow as the slowest chain |
| **parallel** | A + B + C → merge | Independent analyses of the same input | Fast; no agent sees others' work before responding |
| **hierarchical** | manager → [A, B, C] → manager | Complex tasks needing dynamic task decomposition | Flexible; manager adds latency and can fail to delegate well |
| **consensus** | A + B + C → judge | Decisions needing multiple perspectives | Best output quality; most expensive (N agents + judge) |

## Decision Guide

```
Is the task a pipeline where each step transforms the previous output?
├── YES → sequential
└── NO  → Does each agent need to analyze the same input independently?
          ├── YES → Are you optimizing for speed?
          │         ├── YES → parallel
          │         └── NO  → Do you need the best possible answer?
          │                   └── YES → consensus
          └── NO  → Is the task too complex for a fixed pipeline (dynamic subtasks)?
                    └── YES → hierarchical
```

## Steps

### 1. Evaluate the current pattern

Run the team with the current pattern and note the problems:

```bash
python main.py sequential "Analyze our API security posture"
```

| Symptom | Diagnosis |
|---------|-----------|
| Takes too long; agents wait on each other | Sequential — switch to parallel if tasks are independent |
| Output is one-sided; missing perspectives | Sequential or parallel with no synthesis — switch to consensus |
| Tasks vary per run; some agents are irrelevant | Sequential/parallel with fixed agents — switch to hierarchical |
| Manager is the bottleneck; workers are fast | Hierarchical with a weak manager prompt — fix manager, or switch to sequential if tasks are always the same |
| Outputs contradict each other with no resolution | Parallel with no judge — add a judge (consensus) or run sequential |

### 2. Understand the current TEAMS entry

```python
# Before (sequential)
TEAMS["sequential"] = (
    [
        ("researcher", researcher),
        ("writer", writer),
    ],
    {},
)
```

### 3. Migrate to the new pattern

#### Sequential → Parallel

When: agents don't need each other's output; you want speed.

```python
# After (parallel)
TEAMS["parallel"] = (
    [
        ("researcher", researcher),
        ("analyst", analyst),    # ← add more agents if needed
        ("writer", writer),
    ],
    {},
)
```

The call in `main()` changes too:

```python
# Before
result = await sequential(agents, task, bus=bus)

# After — parallel returns a dict of {agent_name: output}
results = await parallel(agents, task, bus=bus)
# Merge results manually, or add a writer to synthesize
combined = "\n\n".join(f"## {name}\n{output}" for name, output in results.items())
result = await writer(f"Synthesize these findings into a unified report:\n\n{combined}")
```

#### Sequential → Hierarchical

When: tasks vary and the manager should decide which agents to use.

```python
# After (hierarchical)
TEAMS["hierarchical"] = (
    [],
    {
        "manager": ("manager", manager),
        "workers": [
            ("researcher", researcher),
            ("analyst", analyst),
            ("writer", writer),
        ],
    },
)
```

Update `main()`:

```python
# Before
agents, _ = TEAMS["sequential"]
result = await sequential(agents, task, bus=bus)

# After
_, kwargs = TEAMS["hierarchical"]
result = await hierarchical(
    kwargs["manager"],
    kwargs["workers"],
    task,
    bus=bus,
)
```

Update the manager's system prompt to list all workers (see `add-agent-role` skill).

#### Sequential → Consensus

When: you want multiple perspectives and a final judgment.

```python
# After (consensus) — parallel agents + a judge
TEAMS["consensus"] = (
    [
        ("researcher", researcher),
        ("analyst", analyst),
    ],
    {"judge": ("judge", judge)},
)
```

Update `main()`:

```python
# Before
result = await sequential(agents, task, bus=bus)

# After
agents, kwargs = TEAMS["consensus"]
result = await consensus(agents, task, judge=kwargs["judge"], bus=bus)
```

#### Parallel → Hierarchical

When: the parallel agents now need to coordinate based on task specifics.

```python
# Before — all agents always run
TEAMS["parallel"] = ([("researcher", researcher), ("analyst", analyst)], {})

# After — manager decides which agents to use
TEAMS["hierarchical"] = (
    [],
    {
        "manager": ("manager", manager),
        "workers": [("researcher", researcher), ("analyst", analyst)],
    },
)
```

### 4. Add the new pattern invocation to main()

```python
async def main(pattern_name: str, task: str):
    print(f"\nPattern: {pattern_name} | Task: {task}\n")

    if pattern_name == "sequential":
        agents, _ = TEAMS["sequential"]
        result = await sequential(agents, task, bus=bus)

    elif pattern_name == "parallel":
        agents, _ = TEAMS["parallel"]
        results = await parallel(agents, task, bus=bus)
        combined = "\n\n".join(f"## {name}\n{out}" for name, out in results.items())
        result = await writer(f"Synthesize into a unified report:\n\n{combined}")

    elif pattern_name == "hierarchical":
        _, kwargs = TEAMS["hierarchical"]
        result = await hierarchical(kwargs["manager"], kwargs["workers"], task, bus=bus)

    elif pattern_name == "consensus":
        agents, kwargs = TEAMS["consensus"]
        result = await consensus(agents, task, judge=kwargs["judge"], bus=bus)

    else:
        print(f"Unknown pattern: {pattern_name}. Available: sequential, parallel, hierarchical, consensus")
        sys.exit(1)

    print(result)
    bus.close()
```

### 5. Test the new pattern

```bash
# Test the migrated pattern
python main.py hierarchical "Analyze our API security posture"

# Compare output to the old pattern
python main.py sequential "Analyze our API security posture"
```

Check:
- Is the output quality equal or better?
- Are all expected agents being used?
- Is the bus showing the expected message flow?

```bash
# Inspect bus traffic after the run
curl http://localhost:3100/bus/channels -H "X-Project: my-project"
# Should show channels for each agent that ran
```

### 6. Verify bus message flow

Each pattern produces a characteristic bus traffic pattern:

```
Sequential A→B→C:      channels: [A, B, C], each with 1 message (their output)
Parallel A+B+C:        channels: [A, B, C], all messages at approximately the same timestamp
Hierarchical M→[A,B]:  channels: [manager_plan, A, B, manager_synthesis]
Consensus A+B→judge:   channels: [A, B, judge]
```

If the channel list doesn't match the expected pattern, an agent silently failed or the wiring is wrong.

## Pattern Comparison Template

Use this to document the decision:

```
Task: [what the team is doing]
Old pattern: sequential
Problem: [why it wasn't working — too slow / missing perspectives / etc.]
New pattern: hierarchical
Reason: [task decomposition varies per run; manager can route to the right specialists]
Trade-off: [manager adds ~1 LLM call; some latency increase acceptable for quality gain]
Test result: [did output quality improve? yes/no and how]
```

## Checklist

- [ ] Current pattern's problems documented before migrating
- [ ] New pattern chosen using the decision guide (not just preference)
- [ ] `TEAMS` dict updated with new configuration
- [ ] `main()` updated with new pattern invocation
- [ ] If hierarchical: manager's system prompt lists all workers
- [ ] New pattern tested with 2-3 representative tasks
- [ ] Bus channel output verified against expected traffic pattern
- [ ] Output quality compared to old pattern (not just "it ran")

## Files involved

| File | Action |
|------|--------|
| `main.py` | Update `TEAMS` dict and `main()` invocation |

## Common mistakes

**Switching patterns without testing the old one first** — you can't evaluate whether the migration improved things if you don't have a baseline. Run the old pattern on 2-3 tasks before migrating.

**Parallel without a synthesis step** — parallel produces N independent outputs. Without a writer or judge to merge them, the caller gets a raw dict of outputs. Always add a synthesis step if users need a single coherent response.

**Hierarchical with a vague manager** — the hierarchical pattern is only as good as the manager's ability to decompose tasks and assign them correctly. If the manager's system prompt doesn't list workers and their capabilities, the manager can't delegate well.

**Forgetting to update `main()`** — updating `TEAMS` without updating the `main()` invocation means the old pattern still runs. Both must be updated.

**Consensus for every task** — consensus uses N agents + a judge (N+1 LLM calls minimum). It's expensive. Use it for decisions that genuinely benefit from multiple perspectives, not for straightforward lookups.
