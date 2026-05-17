# Phase B Report — Scaffolding, Import System & Project Templates

## What Was Built

Phase B (Option B from the roadmap) adds the project onboarding layer — the system that makes the workbench usable day-one for both new and existing projects:

1. **Project templates** — type-specific scaffold directories with seed docs, configs, and CLAUDE.md fragments
2. **Import-vs-scaffold detection** — automatic mode selection based on directory contents
3. **Project scanner** — pure library for inspecting directories without modifying them
4. **`.workbench/` lifecycle** — the workbench-owned directory inside each project
5. **Scaffold API + CLI** — endpoints and Makefile targets for project setup

## Why This Phase

Without this, onboarding a project is manual: curl the projects API, set env vars, hope you don't overwrite CLAUDE.md. With it, `make project NAME=nexus DIR=~/code/nexus TYPE=fullstack` does everything safely — scans the directory, detects existing files, creates only what's safe, offers to append workbench sections to existing files, and preloads the knowledgebase with type-specific guidance.

This is the "workbench feels intelligent" feature. The templates and seed docs mean the workbench already understands what you're building before you write a line of code.

## The Three Modes

### Scaffold Mode (new project, empty directory)

```bash
make scaffold NAME=myapp TYPE=fullstack
```

Triggered when the directory is empty or doesn't exist. The workbench:
1. Creates the directory
2. Writes `CLAUDE.md` from the type-specific template (with project name, description, and development roadmap)
3. Creates `documents/` for RAG source files
4. Creates `.workbench/project.json` with type configuration
5. Creates the project database with all migrations
6. Reports seed docs available for ingestion

### Import Mode (existing project, has files)

```bash
make project NAME=nexus DIR=~/code/nexus TYPE=fullstack
```

Triggered when the directory has project files (package.json, src/, etc.). The workbench:
1. Scans the directory and lists what exists
2. Creates `.workbench/` directory only (always safe — it's the workbench's own space)
3. Writes `.workbench/project.json` with type configuration
4. If `CLAUDE.md` exists but doesn't have the workbench section: **returns the append block for user review** (does NOT auto-write)
5. Creates the project database with all migrations
6. Lists conflicting files that were NOT modified

**The critical safety rule:** import mode NEVER overwrites existing files. It creates `.workbench/` (new directory) and offers to append to `CLAUDE.md` (with user confirmation only).

### Reconnect Mode (.workbench/ already exists)

Triggered when `.workbench/project.json` already exists — the project was previously registered. The workbench:
1. Updates `.workbench/project.json` with current settings
2. Ensures the project database exists (auto-restores from backup if not)
3. Skips everything else

## Template Structure

```
templates/
├── _base/                    ← shared defaults, used by all types
│   ├── project.json          ← default MCP tools, search config
│   ├── scaffold/
│   │   └── CLAUDE.md         ← template with {{VARIABLES}} for new projects
│   └── import/
│       └── claude-md-append.md  ← block offered for appending to existing CLAUDE.md
│
├── fullstack/                ← full-stack web application
│   ├── project.json          ← overrides: tools, roadmap
│   └── seed-docs/
│       └── fullstack-patterns.md  ← architecture, auth, testing patterns
│
├── pwa/                      ← progressive web app
│   ├── project.json
│   └── seed-docs/
│       └── pwa-patterns.md   ← service workers, caching, mobile APIs, Lighthouse
│
├── cli/                      ← command-line tool
│   ├── project.json
│   └── seed-docs/
│       └── cli-patterns.md   ← composability, argument parsing, testing CLIs
│
├── rag/                      ← RAG application
│   ├── project.json          ← includes eval + memory tools
│   └── seed-docs/
│       └── rag-tuning-guide.md  ← chunk sizing, weight tuning, eval best practices
│
├── agent/                    ← AI agent (with optional framework)
│   ├── project.json          ← all tools enabled including memory + conversations
│   └── seed-docs/
│       └── agent-patterns.md ← ReAct, Plan-and-Execute, tool design, safety, framework comparison
│
├── data-pipeline/            ← ETL / data processing
│   ├── project.json
│   └── seed-docs/
│       └── pipeline-patterns.md  ← ETL vs ELT, idempotency, data quality testing
│
└── custom/                   ← no type-specific guidance, all tools available
    └── project.json
```

### How Templates Are Merged

Each project type's `project.json` is **deep-merged** with `_base/project.json`. Type-specific values override base values. Arrays are replaced, not appended. This means a type can narrow the available MCP tools (e.g., CLI projects don't get conversation tools) while inheriting all search config defaults.

### Seed Docs

Seed docs are markdown files that get ingested into the project's knowledgebase when the project is first set up. They're NOT written to the project directory — they go into the database via the RAG ingestion pipeline. This means:
- They don't clutter the project directory
- They're searchable via `/query` from the first moment
- They can be updated by re-ingesting without touching the project

## Pure Libraries Added

### `lib/scanner.ts` — Project Directory Scanner

Pure functions that inspect a directory without modifying anything:

```typescript
scanProjectDirectory(dir) → ScanResult
// Returns: exists, hasProject, hasWorkbench, hasClaudeMd, conflicts[], indicators[]

readExistingClaudeMd(dir) → { content, hasWorkbenchSection } | null
// Reads CLAUDE.md and checks if workbench section is present

determineMode(scan) → "scaffold" | "import" | "reconnect"
// Decides the mode based on scan results
```

### `lib/templates.ts` — Template Renderer

Pure functions for string interpolation and config merging:

```typescript
renderTemplate(template, vars) → string
// Replaces {{VARIABLE}} placeholders

deepMerge(base, override) → merged
// Deep-merges plain objects, right side wins on conflict
```

## Files Created

### Templates (10 files)

| File | Purpose |
|------|---------|
| `templates/_base/project.json` | Shared defaults: tools, search config |
| `templates/_base/scaffold/CLAUDE.md` | Template for new project CLAUDE.md |
| `templates/_base/import/claude-md-append.md` | Block offered for appending to existing CLAUDE.md |
| `templates/fullstack/project.json` + seed doc | Full-stack web application guidance |
| `templates/pwa/project.json` + seed doc | PWA: service workers, mobile APIs, caching |
| `templates/cli/project.json` + seed doc | CLI: argument parsing, composability, testing |
| `templates/rag/project.json` + seed doc | RAG: tuning, evaluation, production patterns |
| `templates/agent/project.json` + seed doc | Agent: ReAct, tools, memory, safety, frameworks |
| `templates/data-pipeline/project.json` + seed doc | ETL, data quality, idempotency |
| `templates/custom/project.json` | All tools, no type-specific guidance |

### Source Code (4 files)

| File | Purpose |
|------|---------|
| `src/lib/scanner.ts` | Directory scanning, conflict detection |
| `src/lib/templates.ts` | Template rendering, config deep-merge |
| `src/services/scaffold.ts` | Scaffold/import orchestration |
| `src/routes/scaffold.ts` | REST endpoints for scaffolding |

### Tests (1 file, 15 tests)

| File | Tests |
|------|-------|
| `src/__tests__/lib/templates.test.ts` | 6 renderTemplate + 5 deepMerge + 4 determineMode |

### Infrastructure

| File | Change |
|------|--------|
| `src/routes/index.ts` | Registers scaffold routes |
| `docker-compose.yml` | Templates volume mount to mcp-server |
| `Makefile` | Updated `project` target, added `scaffold` target |

## Test Results

```
 ✓ src/__tests__/schemas/schemas.test.ts (19 tests)
 ✓ src/__tests__/schemas/phase2-schemas.test.ts (20 tests)
 ✓ src/__tests__/lib/chunker.test.ts (11 tests)
 ✓ src/__tests__/lib/templates.test.ts (15 tests)
 ✓ src/__tests__/lib/hash.test.ts (5 tests)
 ✓ src/__tests__/services/conversations.test.ts (4 tests)

 Test Files  6 passed (6)
      Tests  74 passed (74)
```

## User Interfaces

### Makefile Commands

```bash
# New project from template (scaffold mode)
make scaffold NAME=myapp TYPE=fullstack
make scaffold NAME=my-agent TYPE=agent FRAMEWORK=autogen

# Register existing project (import mode)
make project NAME=nexus DIR=~/code/nexus TYPE=fullstack

# Existing targets still work
make list-projects
make drop-project NAME=nexus
make backup-project NAME=nexus
make restore-project NAME=nexus BACKUP=backups/nexus-20260514.sql.gz
```

### REST API

```bash
# Scaffold or import a project (auto-detects mode)
POST /scaffold
{
  "name": "nexus",
  "directory": "/home/user/code/nexus",
  "type": "fullstack"
}

# Response includes the mode, files created/skipped, and next steps:
{
  "project": { "name": "nexus", "type": "fullstack", ... },
  "scaffold": {
    "mode": "import",
    "filesCreated": [".workbench/project.json"],
    "filesSkipped": ["CLAUDE.md (exists, not modified)"],
    "appendOffered": "---\n<!-- Added by AI Dev Workbench... -->",
    "seedDocsFound": 1
  },
  "next_steps": [
    "Existing project detected — .workbench/ created, no files overwritten",
    "CLAUDE.md exists but doesn't have the workbench section. Call POST /scaffold/append to add it.",
    "1 seed doc(s) available. Ingest them with /ingest.",
    "Set WORKBENCH_PROJECT=nexus to start working"
  ]
}

# Confirm appending to CLAUDE.md (only after user reviews the content)
POST /scaffold/append
{"directory": "/home/user/code/nexus", "content": "---\n<!-- Added by AI Dev Workbench... -->"}

# List seed docs available for a project type
GET /scaffold/seed-docs/fullstack
```

### The .workbench/ Directory

Created inside every project:

```
~/code/nexus/
├── .workbench/
│   ├── project.json      ← project config (type, tools, search weights)
│   └── backup.sql.gz     ← auto-saved database backup (future)
├── CLAUDE.md             ← untouched (import) or generated (scaffold)
└── ... your project files
```

Add `.workbench/` to your project's `.gitignore` if you don't want to track it. Or leave it tracked if the config and backups should travel with the repo.

## Architecture After Phase B

```
                        make project / make scaffold
                                  │
                                  ▼
                          POST /scaffold
                                  │
                          ┌───────┴──────────┐
                          ▼                  ▼
                   scanProjectDirectory   loadProjectConfig
                          │                  │
                     ScanResult         base + type merge
                          │                  │
                   determineMode             │
                     │    │    │              │
               scaffold import reconnect     │
                     │    │    │              │
                     ▼    ▼    ▼              ▼
              Write files as appropriate   createProject
              (.workbench/ always,         (database + migrations)
               CLAUDE.md only if safe)
                          │
                          ▼
                    Return result
              (mode, files, append offer, seed doc count)
```

## What's Next

With templates and import in place, the remaining items from the roadmap are:

- **Phase 3A (Agent Platform):** Agent scaffold with framework templates (`FRAMEWORK=autogen`), agent trace viewer, multi-agent message bus
- **Phase C (Export/Ship):** `make export-stack` that generates production infrastructure from workbench services
- **Seed doc auto-ingestion:** Currently seed docs are counted but not auto-ingested. A startup hook that ingests them on first project registration would close the loop.
- **`.workbench/backup.sql.gz` auto-save:** Auto-backup on project switch or `make down`, auto-restore on project open if database is missing.
