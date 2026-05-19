# Phase 3A-1 Report — Agent Framework Scaffolding

## What Was Built

Phase 3A-1 delivers framework-specific scaffolding for agent projects. When you run `make scaffold TYPE=agent FRAMEWORK=autogen`, the workbench generates a project with working starter code, the framework pinned in requirements, a project-specific Dockerfile and docker-compose, and the framework's documentation pre-ingested into the knowledgebase.

Four frameworks are supported: AutoGen (AG2), CrewAI, LangGraph, and Custom (no framework). The workbench supports all, embeds none.

## What Each Framework Scaffold Includes

### AutoGen (AG2)
- `agent.py` — AssistantAgent with workbench RAG and memory tools, OpenAI-compatible client pointed at Claude, Console runner
- `requirements.txt` — autogen-agentchat, autogen-ext, httpx, OTel
- `Dockerfile` + `docker-compose.yml` — connects to workbench network
- Seed doc: AG2 v0.4 reference covering AssistantAgent, tools, model clients, termination conditions, RoundRobinGroupChat, SelectorGroupChat, testing, and common pitfalls

### CrewAI
- `agent.py` — role-based crew with Researcher and Writer agents, BaseTool implementations for RAG/memory, sequential process
- `requirements.txt` — crewai, crewai-tools, httpx, OTel
- `Dockerfile` + `docker-compose.yml`
- Seed doc: CrewAI reference covering agents (roles/goals/backstories), tasks, crews, process types, custom tools, testing, and pitfalls

### LangGraph
- `agent.py` — StateGraph with agent node, conditional routing (tools vs END), ToolNode wrapping workbench tools, typed AgentState
- `requirements.txt` — langgraph, langchain-anthropic, langchain-core, httpx, OTel
- `Dockerfile` + `docker-compose.yml`
- Seed doc: LangGraph reference covering state, nodes, edges (normal/conditional/entry), compilation, ReAct loop pattern, Plan-then-Execute, Reflection, debugging with ASCII graph, and pitfalls

### Custom (No Framework)
- `agent.py` — pure Anthropic SDK agent loop: sends messages with tool definitions, checks for tool_use blocks, executes tools, feeds results back. Full control, zero framework dependency.
- `requirements.txt` — anthropic, httpx, OTel
- `Dockerfile` + `docker-compose.yml`
- Seed doc: custom agent reference covering the agent loop, tool definitions in Anthropic format, state management options, error handling, guardrails, and scaling to multi-agent

## How Frameworks Connect to the Workbench

Every framework scaffold connects to the workbench via HTTP — not through framework-specific integrations. The pattern is identical across all four:

```python
http = httpx.Client(
    base_url="http://mcp-server:3100",         # Docker network
    headers={"X-Project": "my-project"},        # Project scoping
)

# RAG search
resp = http.post("/query", json={"question": "..."})

# Memory
http.put("/memory/key", json={"value": "..."})
resp = http.get("/memory/key")
```

This is deliberate. The workbench infrastructure (Postgres, Redis, RAG, memory) is framework-agnostic. AutoGen calls the same HTTP endpoints as LangGraph. When you ship, the framework goes with your project; the workbench stays behind.

## Code Architecture

### Framework Resolver (`lib/frameworks.ts`)
Pure functions for framework validation and resolution:
- `resolveFramework("autogen")` → `"autogen"` (validates and normalizes)
- `resolveFramework("PyTorch")` → `"custom"` (unrecognized → falls back to custom)
- `resolveFramework()` → `"custom"` (no framework → custom)
- `isValidFramework(name)` → boolean
- `frameworkLabel("autogen")` → `"AutoGen (AG2)"` (human-readable)

### Scaffold Service Updates
`handleScaffold()` now detects `type=agent` and calls `copyFrameworkScaffold()`, which reads the framework template directory, renders `{{PROJECT_NAME}}` variables in every file, and writes them to the project directory.

`listSeedDocs()` now accepts an optional `framework` parameter. For agent projects, it returns both the type-level seed docs (agent-patterns.md) AND the framework-specific seed docs (e.g., autogen-reference.md). Both get auto-ingested on project creation.

### Template Structure

```
templates/agent/
├── project.json                          ← type config (all MCP tools enabled)
├── seed-docs/
│   └── agent-patterns.md                 ← general agent patterns (all frameworks)
└── frameworks/
    ├── autogen/
    │   ├── scaffold/
    │   │   ├── agent.py                  ← starter code
    │   │   ├── requirements.txt
    │   │   ├── Dockerfile
    │   │   └── docker-compose.yml
    │   └── seed-docs/
    │       └── autogen-reference.md      ← AG2-specific documentation
    ├── crewai/
    │   ├── scaffold/...
    │   └── seed-docs/
    │       └── crewai-reference.md
    ├── langgraph/
    │   ├── scaffold/...
    │   └── seed-docs/
    │       └── langgraph-reference.md
    └── custom/
        ├── scaffold/...
        └── seed-docs/
            └── custom-agent-reference.md
```

## Files Created

### Templates (20 files)

| File | Purpose |
|------|---------|
| `templates/agent/frameworks/autogen/scaffold/agent.py` | AutoGen starter code |
| `templates/agent/frameworks/autogen/scaffold/requirements.txt` | AutoGen dependencies |
| `templates/agent/frameworks/autogen/scaffold/Dockerfile` | Agent container |
| `templates/agent/frameworks/autogen/scaffold/docker-compose.yml` | Agent runtime on workbench network |
| `templates/agent/frameworks/autogen/seed-docs/autogen-reference.md` | AG2 v0.4 documentation |
| `templates/agent/frameworks/crewai/scaffold/agent.py` | CrewAI starter (role-based crew) |
| `templates/agent/frameworks/crewai/scaffold/requirements.txt` | CrewAI dependencies |
| `templates/agent/frameworks/crewai/scaffold/Dockerfile` | Agent container |
| `templates/agent/frameworks/crewai/scaffold/docker-compose.yml` | Agent runtime |
| `templates/agent/frameworks/crewai/seed-docs/crewai-reference.md` | CrewAI documentation |
| `templates/agent/frameworks/langgraph/scaffold/agent.py` | LangGraph starter (state graph) |
| `templates/agent/frameworks/langgraph/scaffold/requirements.txt` | LangGraph dependencies |
| `templates/agent/frameworks/langgraph/scaffold/Dockerfile` | Agent container |
| `templates/agent/frameworks/langgraph/scaffold/docker-compose.yml` | Agent runtime |
| `templates/agent/frameworks/langgraph/seed-docs/langgraph-reference.md` | LangGraph documentation |
| `templates/agent/frameworks/custom/scaffold/agent.py` | Custom agent (pure Anthropic SDK) |
| `templates/agent/frameworks/custom/scaffold/requirements.txt` | Minimal dependencies |
| `templates/agent/frameworks/custom/scaffold/Dockerfile` | Agent container |
| `templates/agent/frameworks/custom/scaffold/docker-compose.yml` | Agent runtime |
| `templates/agent/frameworks/custom/seed-docs/custom-agent-reference.md` | No-framework guide |

### Source Code (2 files)

| File | Purpose |
|------|---------|
| `src/lib/frameworks.ts` | Framework resolution, validation, labels |
| `src/__tests__/lib/frameworks.test.ts` | 7 tests for framework resolver |

### Modified Files

| File | Change |
|------|--------|
| `src/services/scaffold.ts` | Added `copyFrameworkScaffold()`, updated `listSeedDocs()` and `countSeedDocs()` for framework param, import `resolveFramework` |
| `src/routes/scaffold.ts` | Pass `framework` to `ingestSeedDocs()`, accept `framework` query param on seed-docs endpoint |

## Test Results

```
 ✓ src/__tests__/schemas/phase2-schemas.test.ts (20 tests)
 ✓ src/__tests__/schemas/schemas.test.ts (19 tests)
 ✓ src/__tests__/lib/chunker.test.ts (11 tests)
 ✓ src/__tests__/lib/templates.test.ts (15 tests)
 ✓ src/__tests__/lib/frameworks.test.ts (7 tests)
 ✓ src/__tests__/schemas/export.test.ts (5 tests)
 ✓ src/__tests__/lib/hash.test.ts (5 tests)
 ✓ src/__tests__/services/conversations.test.ts (4 tests)

 Test Files  8 passed (8)
      Tests  86 passed (86)
```

## User Interfaces

### Makefile

```bash
# AutoGen agent project
make scaffold NAME=my-bot TYPE=agent FRAMEWORK=autogen

# CrewAI agent project
make scaffold NAME=content-team TYPE=agent FRAMEWORK=crewai

# LangGraph agent project
make scaffold NAME=workflow-agent TYPE=agent FRAMEWORK=langgraph

# Custom agent (no framework)
make scaffold NAME=simple-agent TYPE=agent
make scaffold NAME=simple-agent TYPE=agent FRAMEWORK=custom
```

### REST API

```bash
# Scaffold with framework
POST /scaffold
{
  "name": "my-bot",
  "directory": "/workspace/my-bot",
  "type": "agent",
  "framework": "autogen"
}

# Response includes framework files in filesCreated:
{
  "scaffold": {
    "mode": "scaffold",
    "filesCreated": [
      ".workbench/project.json",
      "CLAUDE.md",
      "documents/",
      "agent.py",
      "requirements.txt",
      "Dockerfile",
      "docker-compose.yml"
    ],
    "seedDocsFound": 2
  },
  "seed_docs": { "ingested": 2, "errors": [] }
}

# List seed docs for a framework
GET /scaffold/seed-docs/agent?framework=autogen
{
  "type": "agent",
  "framework": "autogen",
  "count": 2,
  "files": ["agent-patterns.md", "autogen-reference.md"]
}
```

### What a Scaffolded Agent Project Looks Like

```
~/code/my-bot/
├── .workbench/
│   └── project.json        ← type: agent, framework: autogen
├── CLAUDE.md               ← project memory with agent roadmap
├── documents/              ← RAG source files
├── agent.py                ← AutoGen starter code (working, ready to run)
├── requirements.txt        ← autogen-agentchat pinned
├── Dockerfile              ← agent container image
└── docker-compose.yml      ← runs on workbench network
```

The knowledgebase has 2 docs auto-ingested:
1. `agent-patterns.md` — general agent architecture (ReAct, Plan-and-Execute, tool design, safety)
2. `autogen-reference.md` — AG2-specific documentation (AssistantAgent, GroupChat, testing)

From the first moment in Claude Code:
```
> /query How do I define a custom tool in AutoGen?
→ answers from the pre-ingested autogen-reference.md

> /query What's the difference between ReAct and Plan-and-Execute?
→ answers from the pre-ingested agent-patterns.md
```

## What's Next (Phase 3A-2)

The remaining items from Phase 3A:
- **Agent trace viewer** — custom Grafana dashboard showing agent decision chains, tool calls, state changes
- **Multi-agent message bus** — Redis pub/sub with MCP tools for inter-agent communication
- **Orchestration patterns** — pre-built templates for sequential, parallel, hierarchical agent teams
- **Step-through debugging** — pause/inspect/approve agent actions via WebSocket protocol
