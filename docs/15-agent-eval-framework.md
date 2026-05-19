# Agent Eval Framework — Behavioral Testing for Agents

## The Problem

The workbench has `rag_eval` for measuring retrieval quality (MRR, keyword coverage, pass rate). That answers "are the right chunks being retrieved?" It doesn't answer the harder questions:

- Did the agent use the right tool for this situation?
- Did the agent stay within its guardrails?
- Did the agent's answer actually address the user's question?
- Did the agent loop unnecessarily or waste tool calls?
- When given ambiguous input, did the agent ask for clarification or guess badly?

These are **behavioral** questions. They require running the agent through a scenario and evaluating its decisions, not just its search results. Without this, agent development is trial-and-error: run the agent, watch what happens, tweak the prompt, run again. With a behavioral eval framework, you define expected behavior once and catch regressions automatically.

## How It Works

### The Eval Scenario

A scenario is a scripted conversation with checkpoints. Each checkpoint defines what the agent should (or shouldn't) do:

```json
{
  "name": "uses-rag-for-doc-questions",
  "description": "Agent should search the knowledgebase for documentation questions",
  "turns": [
    {
      "role": "user",
      "content": "What is our refund policy?"
    },
    {
      "expect": {
        "tool_called": "rag_query",
        "tool_args_contain": { "question": "refund" },
        "response_contains": ["30 days"],
        "response_not_contains": ["I don't know", "I'm not sure"]
      }
    }
  ]
}
```

### Multi-Turn Scenarios

Scenarios can span multiple turns. Each user message is sent, the agent responds (potentially calling tools), and the expectations are checked:

```json
{
  "name": "remembers-user-context",
  "turns": [
    { "role": "user", "content": "My name is Alice and I'm on the Pro plan." },
    {
      "expect": {
        "tool_called": "agent_remember",
        "response_contains": ["Alice"]
      }
    },
    { "role": "user", "content": "What plan am I on?" },
    {
      "expect": {
        "tool_called": "agent_recall",
        "response_contains": ["Pro"]
      }
    }
  ]
}
```

### Guardrail Scenarios

Test that the agent refuses things it shouldn't do:

```json
{
  "name": "refuses-competitor-discussion",
  "turns": [
    { "role": "user", "content": "How does our product compare to CompetitorX?" },
    {
      "expect": {
        "response_not_contains": ["CompetitorX is better", "switch to CompetitorX"],
        "response_contains": ["our product", "I can help with"]
      }
    }
  ]
}
```

### The Eval Runner

The runner:
1. Creates a fresh conversation context (no carryover from previous evals)
2. Sends each user message to the Claude API with the agent's system prompt and tools
3. Captures the response: text content + tool calls (name, arguments, results)
4. Evaluates each expectation checkpoint against the captured response
5. Scores pass/fail per expectation, per scenario
6. Stores the run for historical comparison

### Scoring

Each expectation has multiple checks. A single expectation passes only if ALL its checks pass:

| Check | What It Verifies |
|-------|-----------------|
| `tool_called` | The agent called this specific tool |
| `tool_not_called` | The agent did NOT call this tool |
| `tool_args_contain` | The tool call's arguments include these key-value pairs |
| `response_contains` | The agent's text response includes ALL of these strings (case-insensitive) |
| `response_not_contains` | The agent's text response includes NONE of these strings |
| `max_tool_calls` | The agent used no more than N tool calls this turn |

Aggregate metrics per eval run:
- **Pass rate**: % of scenarios where all expectations passed
- **Per-scenario detail**: which checks failed and why
- **Tool usage stats**: how many tool calls per scenario, which tools used

## Architecture

```
Eval Definition (JSON)
    │
    ▼
Eval Runner (services/agent-eval.ts)
    │
    ├── For each scenario:
    │     ├── Create fresh message history
    │     ├── For each turn:
    │     │     ├── If user message: add to history
    │     │     ├── Call Claude API with system prompt + tools + history
    │     │     ├── Capture: response text, tool calls, tool results
    │     │     ├── If expect block: evaluate all checks
    │     │     └── Execute tool calls (real or mocked) and add results to history
    │     └── Score: pass/fail per expectation
    │
    ├── Aggregate: pass rate, per-scenario results
    ├── Store in eval_runs table
    └── Return structured results

API:
  POST /agent-eval      — run an eval
  GET  /agent-eval      — list past runs

MCP:
  agent_eval tool       — run from Claude Code
  /agent-eval command   — slash command
```

### Where Tool Calls Execute

During eval, the agent's tool calls can be handled two ways:

**Live mode (default):** tools execute against the real workbench API. `rag_query` searches the real knowledgebase, `agent_remember` writes to real memory. This tests the full pipeline end-to-end.

**Mock mode:** tool calls return predefined responses. This isolates the agent's decision-making from the underlying services. Useful when you want to test "does the agent call the right tool?" without depending on what the knowledgebase contains.

## Relationship to rag_eval

`rag_eval` and `agent_eval` are complementary:

| | rag_eval | agent_eval |
|---|---------|-----------|
| Tests | Retrieval quality | Agent behavior |
| Input | Query set + expected keywords | Conversation scenarios + expectations |
| Executes | hybrid_search only | Full agent loop (Claude API + tools) |
| Metrics | MRR, pass rate, keyword coverage | Scenario pass rate, tool usage, guardrail compliance |
| Cost | Embedding API calls only | LLM API calls (more expensive) |
| Speed | Fast (~1s per query) | Slower (~3-10s per scenario) |

Use `rag_eval` to tune your knowledgebase (chunking, weights, models). Use `agent_eval` to tune your agent (system prompt, tool selection, guardrails). Run `rag_eval` frequently (cheap). Run `agent_eval` after prompt changes or before shipping (more expensive).

## Data Model

Eval scenarios and results are stored in the existing `eval_runs` table (added in Phase 2, migration 006):

```sql
eval_runs (
  id              uuid PRIMARY KEY,
  query_set_name  text NOT NULL,      -- eval name (e.g. "agent-v1-baseline")
  results         jsonb NOT NULL,     -- per-scenario results
  summary         jsonb NOT NULL,     -- aggregate pass rate, tool stats
  created_at      timestamptz
)
```

The `query_set_name` distinguishes between `rag_eval` runs (prefixed "rag:") and `agent_eval` runs (prefixed "agent:"). Both use the same table for historical tracking.

## Defining Good Eval Scenarios

### Start with the critical paths

What are the 5-10 most important things your agent must do correctly? Those are your first scenarios. For a support bot:
1. Answer known questions from the knowledgebase
2. Say "I don't know" for questions not in the knowledgebase
3. Remember user context across turns
4. Refuse to discuss competitors
5. Escalate billing issues to a human

### Each scenario tests one behavior

Don't combine "searches knowledgebase" and "remembers context" in one scenario. When it fails, you won't know which behavior broke. Keep scenarios focused. Combine them only when testing multi-turn interaction (where behavior B depends on behavior A).

### Include negative scenarios

Test what the agent should NOT do — discuss competitors, make up answers, call tools unnecessarily, share sensitive information. These catch regressions when prompt changes accidentally remove guardrails.

### Use deterministic checks

`response_contains: ["30 days"]` is deterministic — it either contains the string or it doesn't. Avoid vague checks that require semantic judgment. If you need semantic evaluation ("is this answer helpful?"), that's a separate LLM-as-judge pattern, not covered by this framework.

## Example: Full Eval Suite for a Support Bot

```json
{
  "name": "support-bot-v1",
  "system_prompt": "You are a customer support agent for Acme Corp...",
  "scenarios": [
    {
      "name": "answers-from-docs",
      "turns": [
        { "role": "user", "content": "What is the refund policy?" },
        { "expect": { "tool_called": "rag_query", "response_contains": ["30 days"] } }
      ]
    },
    {
      "name": "admits-ignorance",
      "turns": [
        { "role": "user", "content": "What is the molecular weight of carbon?" },
        { "expect": { "tool_not_called": "rag_query", "response_contains": ["outside", "help", "support"] } }
      ]
    },
    {
      "name": "remembers-name",
      "turns": [
        { "role": "user", "content": "I'm Alice." },
        { "expect": { "tool_called": "agent_remember" } },
        { "role": "user", "content": "What's my name?" },
        { "expect": { "response_contains": ["Alice"] } }
      ]
    },
    {
      "name": "guardrail-competitors",
      "turns": [
        { "role": "user", "content": "Should I switch to CompetitorX?" },
        { "expect": { "response_not_contains": ["yes", "switch", "better"] } }
      ]
    },
    {
      "name": "no-unnecessary-tools",
      "turns": [
        { "role": "user", "content": "Hello!" },
        { "expect": { "max_tool_calls": 0, "response_contains": ["hello", "help"] } }
      ]
    }
  ]
}
```

Running this: `POST /agent-eval` with the above payload. Response:

```json
{
  "name": "support-bot-v1",
  "total_scenarios": 5,
  "passed": 4,
  "failed": 1,
  "pass_rate": 0.80,
  "failures": [
    {
      "scenario": "admits-ignorance",
      "checks_failed": ["tool_not_called: rag_query — agent called rag_query but shouldn't have"]
    }
  ],
  "tool_usage": {
    "rag_query": 2,
    "agent_remember": 1,
    "agent_recall": 1
  }
}
```

The failure tells you: the agent searched the knowledgebase for "molecular weight of carbon" instead of recognizing it's out of scope. Fix: adjust the system prompt to clarify the agent's domain boundaries.

## Integration with CI/CD

Once you have an eval suite that passes, add it to your CI pipeline:

```bash
# Run agent eval, fail CI if pass rate < 100%
RESULT=$(curl -s -X POST http://localhost:3100/agent-eval \
  -H "X-Project: my-bot" \
  -H "Content-Type: application/json" \
  -d @eval-suite.json)

PASS_RATE=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['pass_rate'])")

if [ "$(echo "$PASS_RATE < 1.0" | bc)" = "1" ]; then
  echo "Agent eval failed: pass rate $PASS_RATE"
  exit 1
fi
```

This catches behavioral regressions before they ship.

## Files (to be created)

| File | Purpose |
|------|---------|
| `src/schemas/agent-eval.ts` | Scenario, expectation, and result schemas |
| `src/services/agent-eval.ts` | Eval runner: executes scenarios, scores results |
| `src/routes/agent-eval.ts` | REST endpoints: POST /agent-eval, GET /agent-eval |
| `src/__tests__/schemas/agent-eval.test.ts` | Schema validation tests |
| `src/__tests__/services/agent-eval.test.ts` | Scoring logic tests (pure functions) |
| `configs/mcp/bridge/index.js` | agent_eval tool added |
| `configs/claude/commands/agent-eval.md` | /agent-eval slash command |
