---
name: run-multi-agent-eval
description: Write team-level eval scenarios that test coordination between agents — not just individual behavior — and measure overall output quality
domain: multi-agent
type: multi-agent
triggers:
  - "eval the multi-agent team"
  - "test the team"
  - "multi-agent eval"
  - "test coordination"
  - "does the team produce the right output"
  - "team-level eval"
  - "test that the agents work together"
  - "run-multi-agent-eval"
---

# Run a Multi-Agent Eval

## When to use

When verifying that the agent team works correctly end-to-end — not just that individual agents do their job, but that they coordinate, pass information correctly, and produce a coherent final result. Activate when the user says "test the team", "does the pipeline produce the right output?", "write evals for the team", or "make sure coordination works".

## Prerequisites

- Agent team running in `main.py` with at least one working pattern
- Workbench running: `make up`
- Individual agents already tested in isolation (see `add-agent-role` skill)
- `agent_eval` MCP tool available or workbench eval API reachable

## Multi-Agent Eval vs Single-Agent Eval

Single-agent evals (see `write-agent-eval` skill) test one agent's decisions:
- Did it call the right tool?
- Did it refuse the right requests?

Multi-agent evals test the *team*:
- Did information flow correctly from agent A to agent B?
- Did the final output incorporate work from all expected agents?
- Did the manager assign tasks to the right specialists?
- Did the judge correctly synthesize N perspectives?

Both are necessary. Write single-agent evals first; add team-level evals once the team is assembled.

## Steps

### 1. Define team-level success criteria

For each pattern you use, define what "the team succeeded" means:

**Sequential (researcher → writer):**
- Final output incorporates facts from the researcher
- Writer's structure improves on raw research (not just a copy)
- If researcher found nothing relevant, writer says so — doesn't fabricate

**Parallel (researcher + analyst → writer):**
- Final output reflects BOTH researcher and analyst perspectives
- Analyst's risk assessment appears somewhere in the final output
- No agent's output is silently dropped

**Hierarchical (manager → workers):**
- Manager assigned the correct workers for the task type
- All assigned workers produced output (no silent failures)
- Final synthesis is coherent, not just concatenated chunks

**Consensus (N agents → judge):**
- Judge produced a synthesis, not just a copy of one agent
- Judge resolved any contradictions between agents
- Final answer is better quality than any single agent would produce

### 2. Write the eval scenario file

Multi-agent evals are a superset of single-agent evals — they run the full team for one or more inputs and evaluate the final output.

```json
// evals/team-scenarios.json
[
  {
    "name": "sequential-pipeline-produces-structured-report",
    "description": "The researcher → writer pipeline produces a structured report grounded in real findings",
    "pattern": "sequential",
    "turns": [
      {
        "role": "user",
        "content": "What are the key API design patterns in our knowledgebase?"
      },
      {
        "expect": {
          "response_contains": ["API", "pattern"],
          "response_not_contains": [
            "I don't know",
            "No information found",
            "Agent reached maximum"
          ],
          "bus_channel_published": ["researcher", "writer"],
          "max_tool_calls": 10
        }
      }
    ]
  }
]
```

### 3. Team-specific expectation keys

In addition to standard `agent_eval` expectations, multi-agent evals can check coordination:

| Key | Type | What it checks |
|-----|------|----------------|
| `bus_channel_published` | `string[]` | All named channels were published to during this run |
| `bus_channel_not_published` | `string[]` | These channels were NOT published (agent wasn't called) |
| `response_contains` | `string[]` | Final team output contains these strings |
| `response_not_contains` | `string[]` | Final output doesn't contain these strings |
| `max_tool_calls` | `number` | Total tool calls across all agents ≤ N |

### 4. Scenario examples per pattern

#### Sequential: verify information flows between agents

```json
{
  "name": "sequential-writer-uses-researcher-output",
  "description": "Writer's output reflects the researcher's findings, not generic content",
  "pattern": "sequential",
  "turns": [
    {
      "role": "user",
      "content": "Summarize our error handling approach"
    },
    {
      "expect": {
        "bus_channel_published": ["researcher", "writer"],
        "response_contains": ["error", "handling"],
        "response_not_contains": ["generally speaking", "best practices suggest", "typically"]
      }
    }
  ]
}
```

The `response_not_contains` list catches hallucinated generic responses — if the writer says "best practices suggest..." instead of citing actual findings, the knowledgebase content wasn't being used.

#### Parallel: verify all agents contributed

```json
{
  "name": "parallel-both-analysts-contribute",
  "description": "Both researcher and analyst outputs appear in the final synthesis",
  "pattern": "parallel",
  "turns": [
    {
      "role": "user",
      "content": "What are the risks in our current deployment pipeline?"
    },
    {
      "expect": {
        "bus_channel_published": ["researcher", "analyst"],
        "response_contains": ["risk", "deployment"],
        "response_not_contains": ["I only have one perspective"]
      }
    }
  ]
}
```

#### Hierarchical: verify manager delegates correctly

```json
{
  "name": "hierarchical-manager-uses-specialist-for-security",
  "description": "Security tasks route to the security_reviewer, not just the researcher",
  "pattern": "hierarchical",
  "turns": [
    {
      "role": "user",
      "content": "Review our authentication flow for vulnerabilities"
    },
    {
      "expect": {
        "bus_channel_published": ["security_reviewer"],
        "response_contains": ["authentication", "security", "vulnerability"],
        "response_not_contains": ["I assigned this to the researcher"]
      }
    }
  ]
}
```

#### Consensus: verify judge synthesizes

```json
{
  "name": "consensus-judge-synthesizes-not-copies",
  "description": "Judge produces a synthesis, not just a repeat of one agent's response",
  "pattern": "consensus",
  "turns": [
    {
      "role": "user",
      "content": "What caching strategy should we use for our API?"
    },
    {
      "expect": {
        "bus_channel_published": ["researcher", "analyst", "judge"],
        "response_contains": ["caching", "strategy"],
        "response_not_contains": ["Researcher said", "Analyst said", "I agree with agent 1"]
      }
    }
  ]
}
```

### 5. Measure output quality with eval scoring

Beyond checking keywords, evaluate the quality of the final output by running it through the `agent_eval` scorer. Define a quality rubric as an eval scenario with more nuanced expectations:

```json
{
  "name": "output-quality-research-task",
  "description": "Team output for research tasks should be specific, grounded, and structured",
  "pattern": "sequential",
  "turns": [
    {
      "role": "user",
      "content": "What does our documentation say about rate limiting?"
    },
    {
      "expect": {
        "response_contains": ["rate limit"],
        "response_not_contains": [
          "I don't have information",
          "generally",
          "typically",
          "usually"
        ],
        "bus_channel_published": ["researcher", "writer"],
        "max_tool_calls": 8
      }
    }
  ]
}
```

**Scoring strategy:**
- `response_contains` keywords = content is grounded in real findings
- `response_not_contains` hedging phrases = agent isn't fabricating
- `bus_channel_published` = all agents ran
- `max_tool_calls` = no efficiency regression

### 6. Run the team eval

**Via MCP tool:**
```
/agent-eval
```

The `agent_eval` tool reads `evals/scenarios.json` by default. To run team scenarios from a separate file:

```bash
curl -X POST http://localhost:3100/agent-eval \
  -H "Content-Type: application/json" \
  -H "X-Project: your-project" \
  -d @evals/team-scenarios.json
```

### 7. Interpret team eval results

```
✅ sequential-pipeline-produces-structured-report (4/4)
   ✓ bus_channel_published: researcher, writer
   ✓ response_contains: API, pattern
   ✓ response_not_contains: "I don't know"
   ✓ max_tool_calls: 7 ≤ 10

❌ hierarchical-manager-uses-specialist-for-security (2/3)
   ✓ response_contains: authentication, vulnerability
   ✗ bus_channel_published: security_reviewer — channel not found
   ✓ response_not_contains: "I assigned this to the researcher"
```

For `bus_channel_published` failures:
1. Read `manager_plan` channel — did the manager assign the task?
2. If the plan is missing the worker: update manager's system prompt
3. If the plan lists the worker but the channel is missing: check for exceptions in the worker function

### 8. Track team eval history

```bash
# View recent eval runs
curl http://localhost:3100/agent-eval \
  -H "X-Project: your-project"
```

Runs are stored with namespace `"agent:"` in the `eval_runs` table. Track pass rate over time — a drop in pass rate after a system prompt change is a regression signal.

## Scenario Coverage Template

A complete multi-agent eval suite should cover:

```json
[
  // 1. Happy path per pattern
  { "name": "sequential-happy-path", "pattern": "sequential", ... },
  { "name": "parallel-happy-path", "pattern": "parallel", ... },

  // 2. Information flow — does each agent's work reach the final output?
  { "name": "sequential-writer-uses-researcher", ... },
  { "name": "parallel-analyst-contribution-visible", ... },

  // 3. Task routing (hierarchical) — right agent for right task
  { "name": "hierarchical-security-task-routes-to-security-reviewer", ... },
  { "name": "hierarchical-research-task-routes-to-researcher", ... },

  // 4. Quality gates — final output is specific, not generic
  { "name": "output-is-grounded-not-hallucinated", ... },

  // 5. Efficiency — team doesn't waste tool calls
  { "name": "no-excessive-tool-use-for-simple-tasks", ... }
]
```

## Checklist

- [ ] Individual agent evals pass before writing team evals
- [ ] At least one team eval per active orchestration pattern
- [ ] `bus_channel_published` used to verify all agents ran
- [ ] `response_not_contains` includes common hallucination phrases ("generally", "typically", "I don't know")
- [ ] `max_tool_calls` set to catch efficiency regressions
- [ ] Team evals pass consistently (run 2-3 times — LLMs are non-deterministic)
- [ ] Eval pass rate tracked over time via `GET /agent-eval`

## Files involved

| File | Action |
|------|--------|
| `evals/team-scenarios.json` | Create team-level eval scenarios |
| `evals/scenarios.json` | Keep individual agent scenarios here |
| `main.py` | Fix agent prompts or coordination logic if evals fail |

## Common mistakes

**Only writing happy-path scenarios** — happy paths pass easily. Write scenarios that expose failure modes: what happens when the researcher finds nothing? Does the writer fabricate? Does the manager assign the wrong agent?

**Not running evals multiple times** — LLMs are non-deterministic. A scenario that passes once may fail 30% of the time. Run each eval 3+ times and fix scenarios that flake.

**Team evals without individual agent evals** — if a team eval fails, you don't know which agent caused it. Always have individual agent evals (see `write-agent-eval` skill) to isolate which layer broke.

**`response_contains` too specific** — exact phrase matching is fragile. The model may answer correctly but phrase it differently. Use short, essential keywords, not full sentences.

**Ignoring `bus_channel_published` failures** — a missing channel means an agent silently didn't run. This is a coordination bug, not a quality issue. Debug with the `debug-inter-agent-comms` skill.
