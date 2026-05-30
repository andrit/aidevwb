---
name: add-agent-role
description: Define a new agent role — system prompt, make_agent call, tool access, wire into team, and isolated test
domain: multi-agent
type: multi-agent
triggers:
  - "add a new agent"
  - "add an agent role"
  - "add a specialist"
  - "the team needs a new agent"
  - "create a reviewer agent"
  - "add a coder agent"
  - "add a validator"
  - "extend the team"
---

# Add an Agent Role

## When to use

When the multi-agent team needs a new specialist. Activate when the user says "add a reviewer to the team", "we need a security analyst agent", "the team should include a coder", or "add a specialist for X".

## Prerequisites

- `main.py` and `patterns.py` exist (scaffolded multi-agent project)
- The new role is well-defined: what is its job, what does it produce, what inputs does it need?
- Decision made: does this agent need tools (RAG, memory) or is it a pure reasoning agent?

## Steps

### 1. Define the role

Answer these before writing any code:

| Question | Example answer |
|----------|---------------|
| What is this agent's job title? | "Security Reviewer" |
| What does it receive as input? | Research findings or code snippets |
| What does it produce? | A list of security concerns and severity ratings |
| Does it need the knowledgebase? | Yes — to look up known vulnerability patterns |
| Does it need memory? | No — stateless review |
| Which agents pass work to it? | researcher (in a sequential chain) |

### 2. Write the system prompt

The system prompt is the agent's entire identity. Be specific about role, output format, and constraints.

```python
# main.py — add near other agent definitions

security_reviewer = make_agent(
    "security_reviewer",
    """You are a security code reviewer specializing in identifying vulnerabilities.

Your job:
- Review code or architecture descriptions for security risks
- Identify vulnerabilities by category (auth, injection, exposure, etc.)
- Rate each finding: Critical / High / Medium / Low
- Suggest a concrete remediation for each finding

Output format (always use this structure):
## Security Review

**Summary:** [1-2 sentence overview]

**Findings:**
| Severity | Category | Finding | Remediation |
|----------|----------|---------|-------------|
| Critical | Injection | [description] | [fix] |
| ...

**Verdict:** PASS / FAIL / NEEDS REVIEW

If you find no issues, say "No security issues found" — do not fabricate findings.""",
    tools=["rag"],   # can search the knowledgebase for known patterns
)
```

### 3. System prompt design principles

**Be specific about output format** — if the agent produces structured output (JSON, tables, bullet lists), define it explicitly. Agents downstream in the pipeline parse or summarize this output.

**Define the agent's constraints** — what should it NOT do? A security reviewer shouldn't also fix code. A researcher shouldn't form opinions.

**Tell the agent what "done" looks like** — "Respond when you have covered all three aspects" or "Stop when you have verified against three independent sources."

**Keep roles narrow** — if you find yourself writing "and also..." in the system prompt, split into two agents.

### 4. Wire the agent into a team

Add it to the relevant `TEAMS` entry in `main.py`. Choose the right position in the pipeline:

```python
# Sequential: researcher → security_reviewer → writer
TEAMS["sequential_with_review"] = (
    [
        ("researcher", researcher),
        ("security_reviewer", security_reviewer),
        ("writer", writer),
    ],
    {},
)

# Or add to an existing team:
# Replace ("researcher", researcher), ("writer", writer) with a 3-step chain
TEAMS["sequential"] = (
    [
        ("researcher", researcher),
        ("security_reviewer", security_reviewer),  # ← inserted
        ("writer", writer),
    ],
    {},
)
```

For hierarchical patterns, add the new agent to the workers list:

```python
TEAMS["hierarchical"] = (
    [],
    {
        "manager": ("manager", manager),
        "workers": [
            ("researcher", researcher),
            ("analyst", analyst),
            ("security_reviewer", security_reviewer),  # ← added
            ("writer", writer),
        ],
    },
)
```

### 5. Update the manager's system prompt (hierarchical only)

If you're using the hierarchical pattern, the manager needs to know the new specialist exists:

```python
manager = make_agent(
    "manager",
    """You are a project manager coordinating a team of specialists.

Available workers and their expertise:
- researcher: searches the knowledgebase, gathers facts and documentation
- analyst: identifies risks, gaps, and opportunities in the research
- security_reviewer: reviews for vulnerabilities, rates severity, suggests fixes
- writer: synthesizes findings into clear, structured final deliverables

When given a task:
1. Decide which workers are needed (not all tasks need all workers)
2. Assign subtasks to each worker, specifying what you need from them
3. Return a JSON plan: {"assignments": [{"worker": "name", "task": "..."}]}

When given worker results:
- Synthesize into a coherent final deliverable
- Resolve any conflicts between worker outputs
- Format appropriately for the end user""",
)
```

### 6. Test the agent in isolation

Before running the full team, test the new agent function directly:

```python
# test_agents.py — add a test for the new agent
import asyncio
import os
os.environ["WORKBENCH_API"] = "http://localhost:3100"
os.environ["WORKBENCH_PROJECT"] = "my-project"
os.environ["ANTHROPIC_API_KEY"] = os.environ["ANTHROPIC_API_KEY"]

from main import security_reviewer

async def test_security_reviewer():
    # Test with a clear positive case
    result = await security_reviewer(
        "Review this code: `query = f'SELECT * FROM users WHERE id = {user_id}'"
    )
    print("=== Security Reviewer Output ===")
    print(result)
    assert "injection" in result.lower(), "Should identify SQL injection"
    assert "Critical" in result or "High" in result, "Should flag severity"

    # Test with a clean case — should not hallucinate findings
    result = await security_reviewer(
        "Review this: `user_id = int(request.args.get('id', 0))`"
    )
    print("=== Clean Code Review ===")
    print(result)
    # Should find no critical issues

asyncio.run(test_security_reviewer())
```

```bash
python test_agents.py
```

### 7. Test in the full team pipeline

```bash
# Test the new pipeline step
python main.py sequential "Review the authentication module for security issues"

# Check bus channels to see what the agent published
curl http://localhost:3100/bus/channels -H "X-Project: my-project"
curl -X POST http://localhost:3100/bus/read \
  -H "Content-Type: application/json" \
  -H "X-Project: my-project" \
  -d '{"channel": "security_reviewer", "limit": 5}'
```

## Templates

### Minimal agent definition

```python
my_agent = make_agent(
    "my_agent",
    """You are a [role title].

Your job: [what this agent does in one sentence]

Input: [what you receive]
Output: [what you produce, including format]

Constraints:
- [what you should NOT do]
- [when to stop]""",
    tools=[],   # "rag" to enable knowledgebase search
)
```

### Agent with structured JSON output (for hierarchical manager to parse)

```python
planner = make_agent(
    "planner",
    """You are a task planner.

Given a high-level goal, break it into subtasks.

Always respond with JSON in this exact format:
{
  "subtasks": [
    {"id": 1, "task": "...", "assignee": "researcher|analyst|writer"},
    ...
  ],
  "reasoning": "brief explanation of the breakdown"
}

No preamble. No markdown. Pure JSON.""",
)
```

## Checklist

- [ ] System prompt defines: role, input, output format, constraints
- [ ] Agent tested in isolation (`test_agents.py`) before wiring into team
- [ ] Agent added to the correct position in `TEAMS`
- [ ] If hierarchical: manager's system prompt updated with new agent's capabilities
- [ ] Bus channel output reviewed after a full team run
- [ ] Agent produces consistently structured output (not free-form when downstream agents parse it)

## Files involved

| File | Action |
|------|--------|
| `main.py` | Add `make_agent(...)` call; update `TEAMS` |
| `test_agents.py` | Create or extend with isolation test |

## Common mistakes

**System prompt too vague** — "You are a helpful assistant" produces an agent that does everything and specializes in nothing. Name the role, define the inputs, specify the output format.

**Not testing in isolation** — if the full team fails, you don't know which agent caused it. Always test each agent function directly first.

**Too many tools for a specialist** — a security reviewer doesn't need `agent_remember`. Give each agent only the tools its role requires.

**Output format not specified** — downstream agents (or the manager) need to parse or summarize the output. If the format isn't specified, it varies run-to-run, making the pipeline brittle.

**Wiring into the wrong position** — in sequential chains, order matters. A writer can't summarize research that hasn't happened yet. Map the data flow before choosing the position.

**Forgetting to update the manager** — in hierarchical mode, the manager assigns tasks based on its knowledge of available workers. If you add a worker without updating the manager's system prompt, the manager will never use it.
