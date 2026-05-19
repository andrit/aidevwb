# Design Note: The Four Agent Development Skills — Assessment & Gaps

**Date:** May 2026
**Context:** After completing Phases 1, 2, 3C, 3A-1 through 3A-3
**Purpose:** Honest assessment of where the workbench stands on the four core skills for building agents, with prioritized gaps to close.

## The Four Skills

The four most common skills for building AI agents are:
1. RAG (Retrieval Augmented Generation)
2. Evals (Evaluations)
3. Agents (development, debugging, orchestration)
4. Production Deployment

## Current State Per Skill

### 1. RAG — Strong (Production-Ready)

This is the workbench's deepest pillar. Full coverage:

- ✅ Ingestion pipeline with SHA256 change detection
- ✅ Multimodal processing (PDF, images via RAG-Anything)
- ✅ Hybrid search (vector cosine + keyword ts_rank, configurable weights)
- ✅ Configurable embedding models via OpenRouter (swap with one env var)
- ✅ Chunking with configurable size and overlap
- ✅ Project-scoped databases (per-project isolation)
- ✅ Seed docs auto-ingested per project type
- ✅ Retrieval quality evaluation (`rag_eval`)

**Verdict:** You could build a production RAG app today with what's here. No significant gaps.

### 2. Evals — Partial (Retrieval Only, Not Agent Behavior)

What exists:
- ✅ `rag_eval` — runs test query sets, computes MRR, pass rate, keyword coverage
- ✅ Historical eval tracking (eval_runs table, compare across runs)
- ✅ `/eval` slash command for interactive use

What's missing:
- ❌ **Agent behavior evals** — the biggest gap. No framework for testing agent *decisions*, only retrieval quality. Can't answer: "Did the agent use the right tool? Did it stay within guardrails? Did it loop unnecessarily? Did it answer correctly?"
- ❌ **Conversation-level evals** — test an entire multi-turn conversation, not just a single query. Define expected agent responses per turn.
- ❌ **Regression tracking** — compare agent behavior across code changes (not just embedding model changes)
- ❌ **Guardrail testing** — verify the agent refuses to do things it shouldn't

**Priority gap: Agent eval framework.** This is the single highest-impact addition remaining. Without it, agent development is trial-and-error — you run the agent, watch what happens, change the prompt, try again. With it, you define expected behavior once and catch regressions automatically.

**Proposed design:**

```typescript
// An agent eval test case
{
  name: "uses-rag-for-doc-questions",
  scenario: [
    { role: "user", content: "What is our refund policy?" },
    {
      expect: {
        tool_called: "rag_query",                    // must call this tool
        tool_args_contain: { question: "refund" },   // with this in the args
        response_contains: ["30 days"],              // answer includes this
        response_not_contains: ["I don't know"],     // answer doesn't include this
      }
    }
  ]
}

// A guardrail test case
{
  name: "refuses-competitor-discussion",
  scenario: [
    { role: "user", content: "How does our product compare to CompetitorX?" },
    {
      expect: {
        response_not_contains: ["CompetitorX is better", "CompetitorX offers"],
        response_contains: ["I can help with questions about our product"],
      }
    }
  ]
}
```

The eval runner would:
1. Create a temporary conversation
2. Send each user message to the agent (or directly to Claude with tools)
3. Capture tool calls and responses
4. Score against the expectations
5. Report pass/fail per test case with details on what didn't match

Estimated effort: ~400-500 lines (schema + runner + scoring + storage + route + MCP tool).

### 3. Agents — Infrastructure Solid, Debugging Weak

What exists:
- ✅ Four framework scaffolds (AutoGen, CrewAI, LangGraph, Custom) with working starter code
- ✅ Agent memory (persistent key-value state across sessions)
- ✅ Conversation history (multi-turn context management)
- ✅ Message bus (inter-agent communication with polling + SSE + pub/sub)
- ✅ OTel traces for all service calls (embeddings, LLM, search, memory)
- ✅ Agent Trace Viewer dashboard in Grafana
- ✅ Preloaded seed docs per framework (auto-ingested on project creation)

What's missing:
- ❌ **Step-through debugger** — pause an agent mid-loop, inspect state, approve/reject the next action. Currently you can only see what happened after the fact (via traces). You can't intervene.
- ❌ **Agent behavior evals** (see above — this spans both skills)
- ❌ **Orchestration pattern templates** — pre-built multi-agent patterns (sequential, parallel, hierarchical) as reusable code. Currently you build these from scratch using the message bus.

**Priority gap: Step-through debugger**, then orchestration patterns.

The debugger would work via a "checkpoint" mechanism: the agent's tool handler checks a "debug mode" flag. If set, before executing a tool call, it publishes the proposed action to a debug channel and waits for approval. Claude Code (or a human via the API) reviews and approves/rejects. This turns the message bus into a debugging protocol.

Estimated effort: ~600-800 lines (debug mode service, approval/rejection flow, MCP tool for reviewing pending actions, timeout handling).

### 4. Production Deployment — Export Only, Not Automated

What exists:
- ✅ `make export-stack` — generates self-contained Docker Compose or Terraform stack
- ✅ Data export (`seed-data.sql.gz`) for seeding production databases
- ✅ Migration files copied to exported stack
- ✅ Workbench's own Terraform modules (dev/prod) for the workbench infrastructure
- ✅ `deploy.sh` for the workbench's own cloud deployment

What's missing:
- ❌ **Project deployment automation** — `make deploy-project NAME=nexus ENV=staging` that builds the project's Docker images, pushes to a registry, runs migrations, and updates services. Currently the export generates files and you deploy manually.
- ❌ **Staging environment** — no intermediate environment between local and production
- ❌ **CI/CD integration** — no GitHub Actions / GitLab CI templates for automated testing and deployment
- ❌ **Rollback** — no mechanism to revert to a previous deployment
- ❌ **Health monitoring** — the exported stack has no health dashboards (Grafana/OTel are workbench-only unless manually added)

**Priority gap: Project deployment automation.** The export pipeline gets you 80% there — the files exist. Wrapping them in a `deploy-project.sh` that handles the docker build → push → migrate → update cycle would close the gap. CI/CD templates are the next step after that.

Estimated effort: ~200 lines (deploy script adapted from the workbench's deploy.sh, scoped to the exported project stack).

## Priority Order for Closing Gaps

Ranked by impact on agent development workflow:

| Priority | Gap | Skill | Effort | Impact |
|----------|-----|-------|--------|--------|
| 1 | Agent eval framework | Evals | ~500 lines | Highest — transforms agent dev from trial-and-error to test-driven |
| 2 | Step-through debugger | Agents | ~700 lines | High — enables interactive debugging of agent decisions |
| 3 | Project deploy automation | Deployment | ~200 lines | Medium — closes the build→ship lifecycle |
| 4 | Orchestration pattern templates | Agents | ~400 lines | Medium — reduces boilerplate for multi-agent projects |
| 5 | CI/CD templates | Deployment | ~200 lines | Lower — nice-to-have, most teams have their own CI/CD |
| 6 | Conversation-level evals | Evals | ~300 lines | Lower — extends agent evals to multi-turn scenarios |

## Recommendation

**Build the agent eval framework next.** It's the single change that would most improve the experience of building agents with the workbench. Everything else — debugging, deployment, orchestration — is infrastructure. Evals are what make agent development *reliable*.

The agent eval framework would:
- Define test scenarios as structured JSON (user messages + expected behavior)
- Run scenarios against the agent (via the Claude API with tools)
- Capture tool calls, responses, and guardrail violations
- Score pass/fail with detailed diagnostics
- Store results for regression tracking
- Expose via MCP tool (`agent_eval`) and slash command (`/agent-eval`)

This directly addresses the "evals" skill while also improving the "agents" skill (you can't build good agents without testing them).
