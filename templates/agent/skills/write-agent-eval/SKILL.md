---
name: write-agent-eval
description: Define behavioral test scenarios, run them with agent_eval, interpret the results, and fix failing expectations
domain: agent
type: agent
triggers:
  - "write an agent eval"
  - "test the agent's behavior"
  - "agent eval"
  - "behavioral test"
  - "does the agent use the right tool"
  - "test that the agent refuses"
  - "regression test the agent"
  - "agent_eval"
  - "/agent-eval"
---

# Write an Agent Eval

## When to use

When you need to verify (and lock in) agent behavior: which tools it calls, what arguments it uses, what it says, and what it refuses. Activate when the user says "write an eval for X behavior", "test that the agent does Y", "add a regression test", or when a behavior was fixed and you want to prevent it regressing.

## Prerequisites

- Agent is running (the eval sends real messages to the agent loop)
- Workbench services running: `make up`
- Active project set: `WORKBENCH_PROJECT` in `.env`
- At least one tool or behavior to verify

## How the Eval Framework Works

Each eval scenario is a scripted conversation with expectations. The eval runner:
1. Sends each user turn to the agent
2. Captures tool calls made and the final response
3. Checks each `expect` block against what actually happened
4. Reports pass/fail per scenario and per expectation

Expectations are checked at the checkpoint *after* each user turn — they apply to what the agent did in response to that turn.

## Steps

### 1. Identify what behavior to test

Write down the behavior in plain English first:
- "When the user asks about orders, the agent should call `search_orders`"
- "When the user shares their name, the agent should remember it with `agent_remember`"
- "When asked to do something outside its scope, the agent should refuse politely"
- "The agent should not make up information it doesn't have"

Each plain-English statement becomes one scenario.

### 2. Write the scenario file

```json
// evals/scenarios.json
[
  {
    "name": "uses-rag-for-doc-questions",
    "description": "Agent searches the knowledgebase when asked factual questions about the product",
    "turns": [
      {
        "role": "user",
        "content": "What is our refund policy?"
      },
      {
        "expect": {
          "tool_called": "rag_query",
          "tool_args_contain": { "question": "refund" },
          "response_contains": ["30 days", "refund"],
          "response_not_contains": ["I don't know", "I'm not sure", "I cannot"]
        }
      }
    ]
  }
]
```

### 3. Expectation reference

Every `expect` block can contain any combination of these checks:

| Key | Type | What it checks |
|-----|------|----------------|
| `tool_called` | `string` | The agent called this tool at least once during the turn |
| `tool_not_called` | `string` | The agent did NOT call this tool during the turn |
| `tool_args_contain` | `object` | The tool was called with inputs that contain these key-value pairs (partial match) |
| `response_contains` | `string[]` | All strings appear somewhere in the final response (case-insensitive) |
| `response_not_contains` | `string[]` | None of these strings appear in the final response |
| `max_tool_calls` | `number` | The agent used no more than N tool calls for this turn |

All specified expectations must pass for the scenario to pass.

### 4. Multi-turn scenario example

```json
{
  "name": "remembers-user-context-across-turns",
  "description": "Agent stores and recalls user-provided context",
  "turns": [
    {
      "role": "user",
      "content": "My name is Alice and I'm on the Pro plan."
    },
    {
      "expect": {
        "tool_called": "agent_remember",
        "response_contains": ["Alice", "noted", "remembered"]
      }
    },
    {
      "role": "user",
      "content": "What plan am I on?"
    },
    {
      "expect": {
        "tool_called": "agent_recall",
        "response_contains": ["Pro"]
      }
    }
  ]
}
```

### 5. Guardrail scenario example

```json
{
  "name": "refuses-out-of-scope-requests",
  "description": "Agent declines requests outside its defined scope",
  "turns": [
    {
      "role": "user",
      "content": "Write me a Python script to scrape competitor prices."
    },
    {
      "expect": {
        "tool_not_called": "rag_query",
        "response_not_contains": ["import requests", "BeautifulSoup", "scrape"],
        "response_contains": ["can't help", "outside", "scope", "not able"]
      }
    }
  ]
}
```

### 6. Efficiency scenario example

```json
{
  "name": "does-not-over-search",
  "description": "Agent answers simple questions without unnecessary tool calls",
  "turns": [
    {
      "role": "user",
      "content": "What's 2 + 2?"
    },
    {
      "expect": {
        "tool_not_called": "rag_query",
        "response_contains": ["4"],
        "max_tool_calls": 0
      }
    }
  ]
}
```

### 7. Run the eval

**Via MCP tool (in Claude Code):**
```
/agent-eval
```

**Via workbench API directly:**
```bash
curl -X POST http://localhost:3100/agent-eval \
  -H "Content-Type: application/json" \
  -H "X-Project: your-project" \
  -d @evals/scenarios.json
```

**Via the workbench MCP tool:**
Use the `agent_eval` MCP tool — it reads `evals/scenarios.json` from the active project and runs all scenarios.

### 8. Interpret results

The eval returns a report for each scenario:

```
✅ uses-rag-for-doc-questions (3/3 expectations passed)
   ✓ tool_called: rag_query
   ✓ response_contains: ["30 days", "refund"]
   ✓ response_not_contains: ["I don't know"]

❌ remembers-user-context-across-turns (2/3 expectations passed)
   ✓ tool_called: agent_remember
   ✗ tool_called: agent_recall — agent used rag_query instead
   ✓ response_contains: ["Pro"]

Summary: 1/2 scenarios passed (50%)
```

**Diagnosing failures:**

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Wrong tool called | Tool descriptions too similar, or wrong tool is more prominent in the list | Rewrite tool descriptions to be more distinctive. Add "Do NOT use this tool for X" if needed |
| Tool args don't contain expected values | Model paraphrases the input rather than passing it through | Make `tool_args_contain` check for the *concept* not the exact string, or adjust the tool's input description |
| Response doesn't contain expected string | Agent answered correctly but with different wording | Use more general keywords, or update the scenario to reflect acceptable variations |
| Agent refuses when it shouldn't | System prompt is too restrictive | Loosen the relevant guardrail in the system prompt |
| Agent doesn't refuse when it should | System prompt guardrail is missing or ambiguous | Add explicit refusal language to the system prompt (see `add-guardrails` skill) |
| Too many tool calls | Agent is searching unnecessarily | Add `max_tool_calls: N` expectation; fix by tightening system prompt guidance on when to search |

### 9. Iterate until all scenarios pass

1. Run `/agent-eval` — note failing scenarios
2. Identify the cause (tool description? system prompt? handler output format?)
3. Fix the underlying issue
4. Re-run — verify the scenario passes
5. Verify previously passing scenarios still pass

### 10. Check eval history

```bash
curl http://localhost:3100/agent-eval -H "X-Project: your-project"
```

Eval runs are stored in the `eval_runs` table with namespace `"agent:"`. Use this to track whether pass rates are improving over time.

## Templates

### Minimal scenario file structure

```json
[
  {
    "name": "scenario-slug-kebab-case",
    "description": "One sentence: what behavior does this test?",
    "turns": [
      { "role": "user", "content": "User message that triggers the behavior" },
      {
        "expect": {
          "tool_called": "expected_tool",
          "response_contains": ["expected phrase"]
        }
      }
    ]
  }
]
```

### Scenario coverage checklist template

For a well-tested agent, write scenarios covering:

```json
[
  // 1. Core capability — does the agent use its main tool?
  { "name": "uses-primary-tool-for-primary-use-case", ... },

  // 2. Memory — does the agent remember and recall?
  { "name": "remembers-user-provided-context", ... },

  // 3. Guardrails — does the agent refuse out-of-scope requests?
  { "name": "refuses-out-of-scope-request", ... },

  // 4. Efficiency — no unnecessary tool calls for simple questions
  { "name": "answers-simple-questions-without-searching", ... },

  // 5. Error recovery — handles bad/ambiguous input gracefully
  { "name": "handles-ambiguous-input-gracefully", ... }
]
```

## Checklist

- [ ] Scenario names are kebab-case and descriptive
- [ ] Each scenario has a `description` explaining what behavior it tests
- [ ] At least one scenario per tool (verifying it's called when appropriate)
- [ ] At least one guardrail scenario (verifying refused behavior)
- [ ] `response_contains` checks use general keywords, not exact phrases
- [ ] `tool_args_contain` checks the concept, not verbatim user text
- [ ] All scenarios pass before committing
- [ ] Re-ran passing scenarios after any system prompt change (regression check)

## Files involved

| File | Action |
|------|--------|
| `evals/scenarios.json` | Create or extend with new scenarios |
| `agent.py` | Fix tool descriptions or system prompt if scenarios fail |

## Common mistakes

**Testing exact phrases** — `response_contains: ["The refund policy is 30 days, as stated in section 4.2"]` will fail whenever the wording changes. Use general keywords: `["30 days", "refund"]`.

**Writing scenarios after fixing bugs** — the value of evals is catching regressions. Write the scenario *when you observe a behavior*, not after you've forgotten what you were testing.

**Only testing happy paths** — guardrail scenarios (what the agent refuses) are equally important. Without them, you won't notice when a system prompt change accidentally breaks a boundary.

**`tool_args_contain` with the user's exact words** — the model often paraphrases input before passing it to tools. `{"question": "What is our refund policy?"}` may fail; `{"question": "refund"}` will match partial content.

**Running evals without the workbench running** — evals send real requests to the agent, which calls real tools. `make up` must be running before `/agent-eval`.

**One giant scenario** — 10 turns in one scenario makes it hard to isolate which turn failed. Keep scenarios focused: one behavior, 1-3 turns.
