---
name: setup-project-structure
description: Establish a coherent directory layout, naming conventions, and baseline configuration for a custom project that doesn't fit a standard workbench type — so Claude Code has enough structure to navigate and assist effectively
domain: custom
type: custom
triggers:
  - "setup project structure"
  - "project layout"
  - "organize the project"
  - "where should I put"
  - "custom project"
  - "project doesn't fit a template"
  - "how to structure this"
  - "starting from scratch"
---

# Set Up a Custom Project Structure

## When to use

When registering a project with type `custom` — meaning it doesn't fit any of the workbench's standard types (fullstack, RAG, agent, CLI, etc.). The custom type gives you all MCP tools with no type-specific constraints. But without structure, Claude Code has no map to navigate by. This skill establishes enough scaffolding that collaboration is productive from the start.

Activate when the user says "I have a project that doesn't fit any template", "set up my project structure", or "I'm starting something unusual."

## Prerequisites

- Project registered in the workbench (`make project NAME=x DIR=y TYPE=custom`)
- Basic understanding of what the project does and what language/runtime it uses
- `.workbench/` directory exists in the project root (created by `make project`)

## Step 1 — Run Event Storming First

Even for a custom project, run the `event-storming` foundation skill before creating any directory structure. The event storm reveals:
- What domain concepts exist (→ informs directory names)
- What the system does (→ informs which workbench tools are needed)
- Where the boundaries are (→ informs module separation)

A 30-minute solo event storm is better than organizing files around technical layers you think you'll need.

## Step 2 — Establish a CLAUDE.md

The most important file in a custom project is `CLAUDE.md`. It tells Claude Code what this project is, how to work on it, and what conventions to follow. Without it, every conversation starts from zero.

```markdown
# [Project Name]

## What This Is

[2-3 sentences: what the project does, who it's for, what makes it unusual]

## Language / Runtime

[e.g., Python 3.12, Node.js 22, Go 1.22, Rust, etc.]

## How to Run

```bash
# Install dependencies
[command]

# Run in development
[command]

# Run tests
[command]
```

## Directory Layout

```
src/              — [what lives here]
tests/            — [what lives here]
docs/             — [what lives here]
scripts/          — [utility scripts, not production code]
.workbench/       — workbench metadata (don't edit manually)
```

## Key Concepts

- **[Domain concept]**: [what it means in this project]
- **[Another concept]**: [what it means]

## Conventions

- [Naming convention]
- [Error handling approach]
- [How tests are organized]

## MCP Tools in Use

[List which workbench MCP tools are active and what they're used for]
```

## Step 3 — Choose a Directory Layout

Pick the layout that matches how the project thinks about itself — by domain, by technical layer, or by component. Explain the choice in `CLAUDE.md`.

### Domain-driven (recommended for any project with distinct business concepts)

```
src/
├── [domain-concept-1]/      — all code for this concept in one place
│   ├── [concept].ts
│   ├── [concept].test.ts
│   └── types.ts
├── [domain-concept-2]/
├── lib/                     — shared utilities (pure functions only)
├── config.ts                — all configuration in one place
└── index.ts                 — entry point
```

### Technical layer (only if the project is genuinely tool/infrastructure focused)

```
src/
├── models/         — data definitions
├── services/       — business logic
├── handlers/       — request/event handlers
├── utils/          — shared utilities
└── index.ts
```

### Script collection (for automation / tooling projects with no single entry point)

```
scripts/
├── [task-name].ts    — one script per task
├── [task-name].ts
lib/
├── shared.ts         — shared code across scripts
tests/
├── [task-name].test.ts
```

## Step 4 — Set Up a Minimal `package.json` or `pyproject.toml`

Even if the project isn't a library, a well-configured root manifest makes tooling work correctly.

### TypeScript / Node.js

```json
{
  "name": "[project-name]",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev":   "[run command]",
    "build": "tsc",
    "test":  "vitest run",
    "check": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.4",
    "vitest":     "^1.6",
    "@types/node": "^20"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### Python

```toml
# pyproject.toml
[project]
name = "[project-name]"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = []

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
```

## Step 5 — Ingest Project Documentation

Use the workbench RAG tools to make relevant documentation searchable:

```bash
# Ingest design docs, RFCs, or domain references
/ingest docs/design.md
/ingest docs/api-reference.md

# After ingesting, verify it's queryable
/query "what does [key term] mean in this project"
/status
```

This is especially valuable for custom projects where Claude Code can't rely on a standard template's seed docs.

## Step 6 — Configure the Workbench for This Project

```bash
# .workbench/config.json — workbench metadata for this project
# Created automatically by make project, but review it:
{
  "name": "[project-name]",
  "type": "custom",
  "tools": ["rag_ingest", "rag_query", "agent_remember", "project_test"],
  "testCommand": "npm test"  // or "pytest" — used by project_test MCP tool
}
```

## Checklist

- [ ] `event-storming` skill run (even a 30-minute solo version)
- [ ] `CLAUDE.md` created with: what it is, how to run it, directory layout, key concepts
- [ ] Directory layout chosen and explained — domain-driven preferred
- [ ] `package.json` / `pyproject.toml` has `test` and `build` scripts
- [ ] At least one document ingested into the RAG knowledgebase
- [ ] `/status` shows ingested documents
- [ ] `make project` registered the project in the workbench

## Files involved

| File | Action |
|------|--------|
| `CLAUDE.md` | Create: project-specific instructions for Claude Code |
| `package.json` or `pyproject.toml` | Create: scripts, dependencies, tooling config |
| `tsconfig.json` or `pyproject.toml` | Create: language tooling config |
| `src/` | Create: main source directory with initial structure |
| `tests/` | Create: test directory |
| `.workbench/config.json` | Review: created by `make project`, verify testCommand |

## Common mistakes

**Skipping `CLAUDE.md`** — without it, every conversation with Claude Code starts with "what is this project?" The first 5 minutes of every session are wasted on re-orientation. Write it before writing any code.

**Technical layers before domain understanding** — creating `src/models/`, `src/controllers/`, `src/services/` before knowing what the project does produces a structure that fights the domain. Run the event storm first; let the domain tell you what the directories should be called.

**Not configuring `testCommand`** — the `project_test` MCP tool runs whatever command is in `.workbench/config.json`. If it's not set (or wrong), `/test` does nothing useful.

**Ingesting documentation too late** — the RAG knowledgebase is most valuable when it's loaded before the first complex question. Ingest design docs, specs, and references before starting implementation.
