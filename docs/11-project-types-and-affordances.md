# Project Types & Workbench Affordances

## Why This Matters

The workbench claims to help build "any kind of application." That's true in the same way a hammer helps build "any kind of structure" — technically correct, but a framing nailer, a finish nailer, and a sledgehammer serve very different jobs. The workbench needs to know what kind of project it's looking at so it can surface the right tools, suppress irrelevant ones, and guide the builder through the right pipeline.

This document maps out the major project archetypes, what each one needs from the workbench, and what **affordances** (pre-built tools, templates, MCP capabilities, slash commands, project scaffolding) we can build to shorten the path from idea to working software.

---

## The Real Value of Project-Type Awareness

The biggest gain from categorizing project types is not just which MCP tools to surface — it's the **developer experience and the guidance the workbench can offer from the moment a project is created.**

When you tell the workbench "this is an autonomous agent project," three things should happen immediately:

1. **Preloaded context** — The knowledgebase is seeded with relevant documentation before you write a line of code. For an agent project, that means: best practices for tool design, common agent architectures (ReAct, Plan-and-Execute, Reflection), safety/guardrail patterns, memory strategies, and framework-specific docs if you chose one. For a PWA, it means: service worker caching strategies, Web Push API reference, offline-first data patterns, Lighthouse scoring criteria. The workbench already has RAG — preloading domain knowledge into it per project type is a natural extension.

2. **Skills and commands** — Slash commands, MCP tools, and Claude Code project memory (CLAUDE.md) are tailored to the project type. An agent project gets `/agent-trace`, `/test-conversation`, `agent_remember`. A full-stack web app gets `/test`, `/lighthouse`, `/api-validate`. A CLI tool gets `/test`, `/docs-generate`. Irrelevant tools are hidden, not just deprioritized. For existing projects being imported into the workbench, the system must be careful here — it should never overwrite a CLAUDE.md or any other file that already exists. See the import-vs-new distinction below.

3. **Guided workflow** — The CLAUDE.md generated for each project type includes a development roadmap specific to that type. For an agent: "Define your agent's tools → Build the tool implementations → Write the system prompt → Test with sample conversations → Add guardrails → Instrument with traces → Ship." For a web app: "Scaffold → Database schema → API routes → Frontend → Tests → Deploy." The workbench doesn't just provide tools — it tells you what to do next.

This is the difference between "here's a blank workspace with some tools available" and "here's a workspace that already understands what you're building and is ready to help you build it." The tools and templates matter, but the preloaded context and guided workflow are what make the workbench feel intelligent rather than just configured.

### Import vs New: Respecting Existing Projects

The workbench must distinguish between two modes:

**New project** (`make scaffold TYPE=agent NAME=my-bot`) — The workbench creates a fresh directory, writes all template files (CLAUDE.md, project structure, config), seeds the knowledgebase with type-specific docs, and the developer starts from zero. Full control, no conflicts.

**Imported project** (`make project NAME=nexus DIR=~/code/nexus TYPE=fullstack`) — The project already exists with its own files, its own CLAUDE.md, its own conventions. The workbench must not touch any existing file. This is the more common case for early adoption — you have working projects in your current low-fi Claude Code flow and you're moving them to the workbench.

The import flow:

```
1. Workbench scans the project directory
2. Identifies existing files that overlap with what it would generate:
     - CLAUDE.md exists?
     - .claude/ directory exists?
     - Any config files that overlap with workbench templates?
3. For each conflict:
     - READ the existing file
     - COMPARE with what the workbench template would provide
     - OFFER to append workbench-specific sections (MCP tool docs,
       slash command reference, workflow guidance) to the existing file
     - NEVER overwrite, NEVER silently skip
4. For non-conflicting additions:
     - .workbench/ directory is always safe to create (it's new)
     - Seed docs go into the knowledgebase (database), not into the project directory
     - Slash commands go into .workbench/commands/ (not .claude/commands/)
       and are symlinked or merged at runtime
```

For CLAUDE.md specifically, the workbench should:
- Read the existing CLAUDE.md
- Generate the workbench-specific additions (MCP tool reference, slash commands, workbench architecture notes) as a separate block
- Present the additions to the user: "Your CLAUDE.md already exists. I'd like to append these workbench-specific sections. Here's what I'd add: [preview]. Append? / Skip? / Edit first?"
- If approved, append with a clear delimiter:

```markdown
<!-- existing CLAUDE.md content above, untouched -->

---
<!-- Added by AI Dev Workbench — remove this section if you disconnect from the workbench -->
## Workbench Integration
- MCP tools available: rag_ingest, rag_query, rag_status, rag_reindex
- Slash commands: /ingest, /query, /status, /reindex, /test
- Knowledgebase: hybrid search (70% vector, 30% keyword)
- Observability: traces at http://localhost:3200
```

This is primarily a concern for the first few projects being imported from an existing workflow. Once you're creating new projects through the workbench, the scaffold path handles everything cleanly. But the import path must be built and must be safe — destroying someone's working CLAUDE.md on first contact with the workbench would be a terrible first experience.

**Implementation:** Each project type's template gets an `import.sh` script alongside the existing scaffold logic:

```
templates/<type>/
├── scaffold/          ← used for new projects (full file creation)
│   ├── CLAUDE.md
│   ├── commands/
│   └── project.json
├── import/            ← used for existing projects (append-only, non-destructive)
│   ├── claude-md-append.md    ← section to offer appending to existing CLAUDE.md
│   ├── commands/              ← slash commands (placed in .workbench/, not .claude/)
│   └── project.json           ← default config
└── seed-docs/         ← used for both (ingested into DB, never written to project dir)
```

**Implementation:** Each project type gets a `templates/<type>/` directory in the workbench containing:
- `scaffold/` — full project template for new projects (CLAUDE.md, structure, config)
- `import/` — append-only fragments for existing projects (non-destructive)
- `seed-docs/` — markdown files auto-ingested into the project's knowledgebase (database only, never written to project directory)
- `commands/` — project-type-specific slash commands
- `project.json` — default config (which MCP tools to enable, search weights, etc.)

For new projects: `make scaffold TYPE=agent NAME=my-bot` copies the scaffold template, ingests the seed docs, and you start with a knowledgebase that already knows how to help you build what you're building.

For existing projects: `make project NAME=nexus DIR=~/code/nexus TYPE=fullstack` runs the import flow — scans for conflicts, offers to append workbench sections, ingests seed docs into the database, and creates only the `.workbench/` directory in the project.

---

## The Project Taxonomy

### Category 1: Traditional Applications

These are the bread and butter — web apps, mobile apps, SaaS products, business tools. They have a frontend, a backend, a database, user authentication, and business logic. The AI component (if any) is a feature, not the core.

#### 1A: Web Application (Full-Stack)

**Examples:** dashboards, admin panels, e-commerce sites, project management tools, social platforms

**What it needs from the workbench:**
- Standard dev environment (Node, Python, Go, etc.)
- Database access for the app's own data (separate from RAG)
- Claude Code for writing features, debugging, refactoring
- Observability for tracing request flows during development
- Optionally: RAG over the project's own docs/specs for context

**Current workbench coverage:** High. Claude Code + observability + optional RAG handles this well. The workbench mounts the project, Claude writes code, traces show performance.

**Missing affordances:**
- **Project scaffolding templates** — `make scaffold TYPE=nextjs` or `TYPE=fastapi` that generates a starter project with standard structure, linting, CI config
- **Dev database provisioning** — the workbench runs Postgres already; letting the project use a dedicated database for its *application data* (not RAG data) is one migration away
- **Hot reload integration** — mounting the project with a watcher so code changes trigger rebuilds inside the container

#### 1B: Mobile Application

**Examples:** iOS/Android apps, React Native, Flutter, Expo

**What it needs from the workbench:**
- Same as 1A, but the "frontend" is a mobile app that can't run inside Docker
- Backend API development happens in the workbench
- Mobile client development happens on the host (Xcode, Android Studio)
- Claude Code helps with the backend + shared logic

**Current workbench coverage:** Medium. Backend work is fully supported. Mobile client code can be edited by Claude Code (it's just files), but build/run happens on the host.

**Missing affordances:**
- **API contract tools** — MCP tool that reads an OpenAPI spec and validates the backend matches it. Mobile and backend teams drift; this catches it.
- **Mock server generation** — from an API spec, generate a mock server so mobile dev can proceed without the real backend

#### 1B-ii: Progressive Web App (PWA)

**Examples:** installable web apps, offline-capable dashboards, cross-platform apps that bypass app stores

**What it needs from the workbench:**
- Same full-stack capabilities as 1A
- Service worker scaffolding (caching strategies, offline fallback, background sync)
- Web App Manifest generation
- Mobile-specific API awareness (push notifications, camera, geolocation, device storage)
- Lighthouse/performance auditing awareness

**Current workbench coverage:** High for the code, same as 1A. PWAs are web apps — Claude Code writes them the same way. The gap is in the mobile API surface area and PWA-specific boilerplate.

**Why list PWA separately:** The code difference from a standard web app is small, but the *knowledge surface* is different. Service workers, cache invalidation strategies, manifest files, installability criteria, push notification APIs, and offline-first data patterns are a distinct body of knowledge. A developer choosing PWA benefits from having that context preloaded.

**Missing affordances:**
- **PWA scaffold** — `make scaffold TYPE=pwa` with service worker, manifest.json, offline fallback page, and caching strategy templates
- **Mobile API reference** — preloaded knowledgebase with Web Push API, Background Sync, Cache API, IndexedDB patterns, and platform-specific quirks (iOS Safari limitations, Android TWA)
- **Lighthouse integration** — MCP tool that runs a Lighthouse audit and feeds the results to Claude as context for optimization

#### 1C: CLI / Developer Tool

**Examples:** command-line utilities, build tools, code generators, SDK packages

**What it needs from the workbench:**
- Standard dev environment
- Heavy emphasis on testing (CLIs need comprehensive test suites)
- Documentation generation
- Package publishing workflow

**Current workbench coverage:** High. Claude Code is excellent at writing CLI tools.

**Missing affordances:**
- **Test runner MCP tool** — `/test` slash command that runs the project's test suite and feeds results back to Claude as context
- **README/docs generation** — MCP tool that reads the codebase and generates documentation

---

### Category 2: AI-Native Applications

These are applications where AI is the core capability, not a feature bolted on. The workbench's RAG/MCP infrastructure is directly relevant.

#### 2A: RAG Application (Knowledgebase-Powered)

**Examples:** documentation search, customer support bot, research assistant, compliance checker

**What it needs from the workbench:**
- Full RAG pipeline (ingest, embed, search, generate)
- Document management and monitoring
- Embedding model experimentation (swap models, compare results)
- Search quality evaluation (are the right chunks being retrieved?)

**Current workbench coverage:** Very high. This is what the workbench was originally built for.

**Missing affordances:**
- **Search quality evaluation** — `/eval` command that runs a set of test queries and scores retrieval quality (precision, recall, MRR). Without this, you're tuning search blind.
- **Chunk inspector** — MCP tool that shows which chunks a query retrieved, their scores, and the raw text. Currently you get scores in the API response, but a visual or interactive inspector would help debug retrieval.
- **Embedding model comparison** — ingest the same docs with two models, run the same queries, compare scores side-by-side. Currently requires manual reindex + re-query.
- **Ingestion dashboard** — Grafana panel showing documents ingested, chunk counts over time, queue throughput, embedding API costs

#### 2B: Conversational Agent (Chatbot / Assistant)

**Examples:** customer service bot, internal helpdesk, sales assistant, personal assistant

**What it needs from the workbench:**
- RAG for grounding responses in real data
- Conversation history management (multi-turn)
- Tool/function calling (the agent needs to *do things*, not just answer)
- Guardrails and safety (prevent off-topic or harmful responses)
- Testing framework for conversation flows

**Current workbench coverage:** Medium. The RAG pipeline provides grounding. Claude's tool use capability is there via MCP. But conversation management, guardrails, and testing are not built in.

**Missing affordances:**
- **Conversation history store** — a `conversations` table + MCP tools for managing multi-turn context. Currently the workbench is stateless per query.
- **Agent prompt templates** — pre-built system prompts for common agent types (support bot, sales, internal helpdesk) with variable slots for company-specific info
- **Guardrail rules engine** — define rules like "never discuss competitors by name" or "always include a disclaimer for medical questions" that are enforced at the orchestration layer
- **Conversation test runner** — define test conversations (user says X, agent should say something about Y, not Z) and run them automatically

#### 2C: Autonomous Agent (Tool-Using)

**Examples:** coding agent, research agent, data analysis agent, web scraping agent, DevOps agent

**What it needs from the workbench:**
- Tool definition and registration (the agent's capabilities)
- Execution environment (sandbox for running agent-generated code)
- Memory / state persistence across agent steps
- Observation and debugging (what did the agent do, why, what went wrong)
- Safety boundaries (what the agent is allowed to do)

**Current workbench coverage:** Low-Medium. The MCP infrastructure provides tool definition. Claude Code itself is an autonomous agent. But there's no framework for *building your own* agents.

**Missing affordances:**
- **Agent scaffold** — template for defining an agent: its tools, system prompt, memory strategy, and safety boundaries. `make scaffold TYPE=agent NAME=research-bot`
- **Tool sandbox** — isolated execution environment for agent-generated code (the workbench already runs Docker, so this is nesting containers or using lightweight sandboxes)
- **Agent trace viewer** — Grafana dashboard showing the agent's decision chain: which tools it called, in what order, what inputs/outputs, where it got stuck
- **Step-through debugging** — ability to pause an agent mid-execution, inspect its state, and manually approve/reject the next action
- **Agent memory MCP tools** — `agent_remember`, `agent_recall`, `agent_forget` tools that persist structured memories across sessions (beyond RAG — more like key-value state)

#### 2D: Multi-Agent System

**Examples:** research team (planner + researcher + writer), software team (architect + coder + reviewer), sales pipeline (qualifier + proposal writer + follow-up)

**What it needs from the workbench:**
- Everything from 2C, multiplied by N agents
- Inter-agent communication (message passing, shared state)
- Orchestration (who runs when, how do agents hand off to each other)
- Conflict resolution (what happens when agents disagree)

**Current workbench coverage:** Low. The infrastructure exists (Redis for message passing, Postgres for shared state) but there's no multi-agent framework.

**Missing affordances:**
- **Agent registry** — define multiple agents with different roles, tools, and prompts, all managed through the workbench
- **Message bus** — Redis pub/sub channels for inter-agent communication, with MCP tools for sending/receiving
- **Orchestration patterns** — pre-built patterns: sequential (A → B → C), parallel (A + B → C), hierarchical (manager delegates to workers), consensus (vote on output)
- **Shared workspace** — a scratchpad (database table or file area) where agents can read/write intermediate artifacts

#### Agent Framework Strategy: Support All, Embed None

The workbench supports all relevant agent frameworks (AutoGen/AG2, CrewAI, LangGraph, Semantic Kernel, custom) but does not embed any specific one into its core. The reasoning:

**Why not embed a framework:**
- Agent frameworks are Python-heavy; the workbench orchestration layer is TypeScript. Embedding one means either a new container + language boundary for agent logic, or moving orchestration to Python (contradicting the architecture).
- Frameworks have strong opinions about agent lifecycle, message format, and tool registration that conflict with MCP. You'd end up bridging MCP tools into the framework's tool format and bridging conversation history back out — two translation layers that hide what's happening.
- Frameworks want to be the runtime. The workbench's MCP server already handles tool orchestration. Two orchestration layers that don't know about each other creates confusion.
- Framework churn is real. AutoGen rewrote its API between v0.2 and v0.4. Coupling the workbench to a specific framework version creates maintenance burden and lock-in.

**What the workbench provides instead:**
- **Scaffolding with framework choice** — `make scaffold TYPE=agent FRAMEWORK=autogen` generates a project that includes AutoGen as a *project dependency*, with starter code, a project-specific docker-compose, and the workbench's RAG knowledgebase available as an HTTP tool the agents can call.
- **Framework-agnostic infrastructure** — agent memory (database tables), message passing (Redis pub/sub), observability (OTel traces), and the RAG knowledgebase work with *any* framework because they operate at the storage and protocol layer, not the framework layer.
- **Preloaded framework docs** — when you choose a framework, the workbench seeds the project knowledgebase with that framework's documentation. `/query How do I define a custom tool in AutoGen?` works from minute one.
- **Framework-neutral trace viewer** — agent execution traces are captured via OpenTelemetry, which any Python framework can emit. The Grafana dashboards show decision chains, tool calls, and state regardless of which framework produced them.

**The scaffold parameter:**

```bash
# AutoGen (Microsoft)
make scaffold TYPE=agent FRAMEWORK=autogen NAME=research-bot

# CrewAI
make scaffold TYPE=agent FRAMEWORK=crewai NAME=content-team

# LangGraph (LangChain)
make scaffold TYPE=agent FRAMEWORK=langgraph NAME=workflow-agent

# No framework (custom, use workbench primitives directly)
make scaffold TYPE=agent NAME=simple-agent
```

Each framework scaffold includes:
- `requirements.txt` or `pyproject.toml` with the framework pinned
- Starter agent definition file with the framework's idioms
- A tool that calls the workbench's RAG API (HTTP, framework-agnostic)
- A `docker-compose.yml` for the project's own agent runtime
- Framework-specific seed docs for the project knowledgebase

When you ship, the framework goes with your project. The workbench stays behind. If you later decide CrewAI is better than AutoGen, you swap it in your project without touching the workbench.

**When tighter integration makes sense:** If you find yourself building multiple agent projects and every one needs the same boilerplate (OTel instrumentation, memory hooks, tool registration patterns), then promoting that boilerplate into a workbench-managed "agent runtime" library makes sense. But that's an optimization after you've built 3-4 agent projects and see the pattern — not a design decision to make upfront.

---

### Category 3: Data-Centric Applications

#### 3A: Data Pipeline / ETL

**Examples:** data warehouse ingestion, log processing, analytics pipeline, data migration

**What it needs from the workbench:**
- Database tooling (the workbench already has Postgres)
- Queue/job processing (Redis + BullMQ already there)
- Schema management
- Data quality validation

**Current workbench coverage:** Medium. The queue system and database are present. The RAG ingestion pipeline is a specific kind of ETL that could be generalized.

**Missing affordances:**
- **Schema validation MCP tool** — `/validate-schema` that checks data against a JSON Schema or database schema
- **Data preview** — MCP tool that samples data from a table or file and shows it in a formatted view
- **Pipeline monitoring** — Grafana dashboards for job throughput, error rates, processing times

#### 3B: ML / AI Model Development

**Examples:** fine-tuning a model, training a classifier, building a recommendation system, evaluating model performance

**What it needs from the workbench:**
- GPU access (not available in the current Docker setup)
- Experiment tracking
- Dataset management
- Model versioning

**Current workbench coverage:** Low. The Python worker has ML libraries, but GPU access and experiment tracking aren't built in.

**Missing affordances:**
- **Experiment tracker integration** — MCP tools for logging to Weights & Biases or MLflow
- **Dataset versioning** — track which data was used for which training run
- **Evaluation harness** — run a model against a test set and log results

---

### Category 4: Integration-Heavy Applications

#### 4A: API Integration Service

**Examples:** webhook handler, third-party API aggregator, middleware, Zapier-like automation

**What it needs from the workbench:**
- HTTP client tooling
- Webhook testing (receive and inspect incoming webhooks)
- API key management
- Request/response logging

**Current workbench coverage:** Medium. The MCP server is itself an API integration service. The pattern exists but isn't exposed as reusable tooling.

**Missing affordances:**
- **Webhook receiver** — built-in endpoint that captures incoming webhooks and makes them queryable via MCP tools
- **API client MCP tool** — `/api-call GET https://api.example.com/users` that makes HTTP requests and returns results to Claude
- **Secret rotation tooling** — rotate API keys across services without downtime

#### 4B: Browser Extension / Desktop App

**Examples:** Chrome extensions, Electron apps, Tauri apps

**What it needs from the workbench:**
- Standard web dev environment (same as 1A)
- Extension/app-specific build tooling
- Testing against browser APIs

**Current workbench coverage:** High for the code, low for the runtime. The code lives in files that Claude can edit, but testing requires the host environment.

**Missing affordances:**
- **Extension scaffolding** — `make scaffold TYPE=chrome-extension` with manifest.json, popup, content script, background worker
- **Build integration** — MCP tool that triggers the host's build process and reports results

---

## Affordance Priority Matrix

Grouping all affordances by impact and effort:

### Tier 1: High Impact, Low Effort (Build First)

These are small additions that benefit nearly every project type:

| Affordance | Benefits | Implementation |
|-----------|----------|----------------|
| **Test runner MCP tool** (`/test`) | Every project needs tests. Claude runs them, sees failures, fixes code. | Slash command + MCP tool that runs a configurable test command and returns output. ~50 lines. |
| **Project scaffolding** (`make scaffold TYPE=...`) | Removes the blank-page problem for new projects. | Template directories + a copy script. ~100 lines per template. |
| **Dev database per project** | Projects need their own app data (separate from RAG). Multi-DB architecture supports this naturally. | One `createdb` call during project setup. Already designed into multi-project. |
| **Search quality eval** (`/eval`) | RAG projects can't improve without measurement. | Test query set + scoring script. ~200 lines. |

### Tier 2: High Impact, Medium Effort

These are meaningful features that serve specific (but common) project types:

| Affordance | Benefits | Implementation |
|-----------|----------|----------------|
| **Conversation history store** | Required for any chatbot/assistant project. | New table + MCP tools for create/read/list conversations. ~300 lines. |
| **Agent scaffold + memory tools** | Required for any autonomous agent project. | Template + `agent_remember`/`agent_recall` MCP tools + state table. ~500 lines. |
| **Ingestion + search dashboard** | Visual feedback for RAG tuning. Currently flying blind. | Grafana dashboard JSON + OTel instrumentation in ingest/search services. ~200 lines + dashboard config. |
| **API contract validation** | Catches drift between frontend/mobile and backend. | OpenAPI spec parser + endpoint tester. ~300 lines. |

### Tier 3: High Impact, High Effort

These are substantial features that transform the workbench for specific use cases:

| Affordance | Benefits | Implementation |
|-----------|----------|----------------|
| **Agent trace viewer** | Debug autonomous agents visually (decision chain, tool calls, state). | Full OTel instrumentation of agent execution + custom Grafana dashboard. ~800 lines. |
| **Multi-agent orchestration** | Enables building agent teams. | Agent registry + message bus + orchestration patterns. ~1500 lines. |
| **Embedding model comparison** | Side-by-side search quality comparison across models. | Dual-index pipeline + comparison UI. ~600 lines. |
| **Step-through agent debugging** | Pause, inspect, approve/reject agent actions. | WebSocket-based debug protocol + UI. ~1000 lines. |

### Tier 4: Lower Priority (Nice to Have)

| Affordance | Notes |
|-----------|-------|
| Webhook receiver | Useful for integration projects, low usage frequency |
| ML experiment tracking | Needs GPU access to be truly useful |
| Extension scaffolding | Niche audience |
| Mock server generation | Useful but tools like Prism already do this |

---

## Project Type → Affordance Map

Which affordances matter for which project type:

```
                          Scaffold  Test  DevDB  Eval  ConvHist  AgentMem  Trace  MultiAgent
                          ────────  ────  ─────  ────  ────────  ────────  ─────  ──────────
1A Web App (Full-Stack)      ●       ●      ●                                       
1B Mobile App                ●       ●      ●                                       
1B-ii PWA                    ●       ●      ●                                       
1C CLI / Dev Tool            ●       ●                                               
2A RAG Application           ●       ●      ●     ●                                 
2B Conversational Agent      ●       ●      ●     ●      ●                          
2C Autonomous Agent          ●       ●      ●            ●        ●        ●        
2D Multi-Agent System        ●       ●      ●            ●        ●        ●       ●
3A Data Pipeline             ●       ●      ●                                       
3B ML Development            ●       ●      ●                                       
4A API Integration           ●       ●      ●                                       
4B Extension / Desktop       ●       ●                                               

● = directly relevant to this project type
```

**Observation:** Test runner and scaffolding benefit literally every type. Dev database benefits all but the simplest tools. These are the universal affordances. Conversation history and agent memory are the fork point — they separate "traditional app" from "AI-native app" project types.

**Note on PWA:** The affordance columns above don't capture PWA's main differentiator. PWA looks identical to a full-stack web app in terms of *tooling*, but it diverges in *preloaded context*. The PWA scaffold seeds the knowledgebase with service worker patterns, Cache API strategies, Web Push documentation, and platform quirks (iOS Safari limitations, Android TWA). The tools are the same; the knowledge surface is different. This pattern — same tools, different preloaded context — repeats across several types and is the core argument for project-type awareness in the workbench.

---

## The Pipeline Model

Every project, regardless of type, follows a lifecycle:

```
1. INIT       — create project, choose type, scaffold if needed
2. CONTEXT    — ingest relevant docs, set up knowledgebase (optional)
3. BUILD      — write code, with Claude Code + MCP tools
4. TEST       — run tests, evaluate quality, iterate
5. OBSERVE    — trace performance, debug issues
6. SHIP       — deploy (Terraform for cloud, or project's own CI/CD)
7. MAINTAIN   — update docs, re-ingest, monitor
```

The workbench affordances map to pipeline stages:

```
Stage     Affordances
─────     ───────────
INIT      Project scaffolding, dev database provisioning, project type selection
CONTEXT   RAG ingestion, doc management, embedding model selection
BUILD     Claude Code, MCP tools (project-type-specific), test runner
TEST      Test runner, search eval, conversation tester, agent step-through
OBSERVE   Grafana dashboards, agent traces, ingestion monitoring
SHIP      Terraform, deploy scripts, database backup
MAINTAIN  Re-ingestion, reindex, backup/restore, project archival
```

Each project type emphasizes different stages. A CLI tool spends most time in BUILD and TEST. An autonomous agent spends heavily in BUILD, TEST, and OBSERVE. A RAG application spends more time in CONTEXT and TEST (tuning search quality).

---

## Recommended Build Order

Based on the priority matrix and the pipeline model:

**Phase 1 — Universal affordances (benefits every project):**
1. Multi-project support (already designed, doc 10)
2. Test runner MCP tool (`/test`)
3. Project scaffolding system (`make scaffold`)
4. Dev database per project (falls out of multi-DB naturally)

**Phase 2 — AI-native affordances (benefits agent/RAG projects):**
5. Conversation history store + MCP tools
6. Search quality evaluation (`/eval`)
7. Agent memory tools (`agent_remember` / `agent_recall`)
8. Ingestion and search Grafana dashboards

**Phase 3 — Advanced agent affordances:**
9. Agent scaffold template
10. Agent trace viewer
11. Multi-agent message bus + orchestration patterns
12. Step-through debugging

Phase 1 makes the workbench useful for *all* project types. Phase 2 makes it powerful for AI-native work. Phase 3 makes it a serious agent development platform.
