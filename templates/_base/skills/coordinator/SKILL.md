---
name: coordinator
description: Wire two or more workbench projects together using the provides/consumes capability model — async via message bus, sync via HTTP with X-Project routing, with the registry as the discovery layer
domain: architecture
type: cross-cutting
triggers:
  - "wire projects together"
  - "project composition"
  - "connect two projects"
  - "add RAG to my app"
  - "share embeddings between projects"
  - "add capability"
  - "capability routing"
  - "project provides"
  - "project consumes"
  - "coordinator"
---

# Skill: coordinator

## When to Use

When two or more workbench projects need to cooperate at runtime — one provides a capability (search, reasoning, pipeline) and another consumes it.

**Use this skill (peer projects — Pattern A) when:**
- The capability needs an independent lifecycle (deploy, scale, replace, reindex without touching the consumer)
- Multiple projects share the same capability (one RAG project serving three apps)
- You want to swap implementations (Elasticsearch instead of pgvector) without changing consumers

**Use `make add-capability` (additive — Pattern B) when:**
- The capability lives with this project permanently and shares its lifecycle
- You just need the MCP tools and skills available, not cross-project routing

Both approaches use the same capability contract layer. Pattern A adds runtime routing on top.

---

## Prerequisites

- Both projects registered: `make list-projects`
- Workbench running: `make up`
- Read `docs/23-design-principles-guide.md` — specifically the composition model diagram and the DIP section
- Understand the capability token vocabulary (see §Capability Tokens below)

---

## Steps

### Step 1 — Understand what each project provides and needs

Check the capability contracts before touching any config:

```bash
# See all capabilities and their provides/consumes
make list-capabilities

# Inspect a specific capability in detail
make show-capability CAPABILITY=rag
make show-capability CAPABILITY=agent
make show-capability CAPABILITY=data-pipeline
```

Read `templates/_base/skills/INDEX.md` — each project-type section has a `Contract:` line listing its tokens.

If the project already has a capability applied, check its current config:
```bash
curl -s http://localhost:3100/projects/my-project | python3 -m json.tool | grep -A5 "provides\|consumes\|capabilities"
```

---

### Step 2 — Apply capabilities to each project

The `provides`/`consumes` arrays in a project's config are the runtime declarations the coordinator reads. The fastest way to populate them correctly is `make add-capability`, which reads `capability.json` (the source of truth) and union-merges everything — including `provides` and `consumes` token strings:

```bash
# Provider side: add RAG capability to my-rag-app
make add-capability NAME=my-rag-app CAPABILITY=rag
# → adds provides: ["hybrid_search", "document_ingestion", "search_eval", "knowledgebase"]
# → adds consumes: ["embedding_service"]
# → adds mcp_tools: rag_ingest, rag_query, rag_status, rag_eval, rag_reindex
# → adds all rag skills

# Consumer side: add agent capability to my-app (so it can call search)
make add-capability NAME=my-app CAPABILITY=agent
# → adds consumes: ["llm_api", "hybrid_search"]
```

To declare provides/consumes manually (for custom capability tokens not in any type):
```bash
curl -s -X PATCH http://localhost:3100/projects/my-project/config \
  -H "Content-Type: application/json" \
  -d '{"config": {"provides": ["hybrid_search"], "consumes": ["llm_api"]}}'
```

---

### Step 3 — Discover providers at runtime

Until `GET /capabilities/:name` is implemented, discovery uses the projects list:

```bash
# Local filesystem — lists all type contracts (no API needed)
make list-capabilities

# All registered projects with their config
curl -s http://localhost:3100/projects | python3 -m json.tool
```

**Helper: find which project provides a token**
```bash
curl -s http://localhost:3100/projects | python3 -c "
import sys, json
projects = json.load(sys.stdin)
token = 'hybrid_search'
for p in projects:
    if token in (p.get('config') or {}).get('provides', []):
        print(f\"{p['name']} ({p['type']}) provides {token}\")
"
```

When `GET /capabilities/:name` is implemented, this becomes:
```bash
curl -s http://localhost:3100/capabilities/hybrid_search | python3 -m json.tool
```

---

### Step 4a — Sync routing (HTTP via X-Project header)

All workbench projects share one MCP server at `:3100`. Cross-project calls route via the `X-Project` header — no separate base URLs needed.

**Capability token → conventional endpoint:**

| Token | HTTP endpoint | Notes |
|-------|--------------|-------|
| `hybrid_search` | `POST /query` | Body: `{question, match_count?, vector_weight?}` |
| `document_ingestion` | `POST /ingest` | Body: `{filepath}` |
| `search_eval` | `POST /eval` | Body: `{queries[]}` |
| `agent_memory` | `PUT /memory/:key` / `GET /memory/:key` | Key-value store |
| `agent_eval` | `POST /agent-eval` | Body: `{scenario, expectations[]}` |
| `message_bus` | `POST /bus/publish` / `POST /bus/read` | Body: `{channel, payload}` |
| `data_transform` | Project-specific — check its README | — |
| `rest_api` | Project-specific — follows its route structure | — |

**TypeScript capability client (create once, reuse across the project):**

```typescript
// src/lib/capability-client.ts
const WORKBENCH_API = process.env.WORKBENCH_API ?? "http://mcp-server:3100";

export async function queryCapability(
  providerProject: string,
  endpoint: string,
  body: unknown
): Promise<unknown> {
  const [method, path] = endpoint.split(" ");
  const res = await fetch(`${WORKBENCH_API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Project": providerProject,   // routes to this project's database
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Capability call failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Future: resolves provider from registry instead of hardcoding project name
export async function resolveProvider(token: string): Promise<string | null> {
  const res = await fetch(`${WORKBENCH_API}/capabilities/${token}`);
  if (!res.ok) return null;
  const data = await res.json() as { providers?: Array<{ project: string }> };
  return data.providers?.[0]?.project ?? null;
}
```

**Usage in a consuming project:**

```typescript
// Hardcoded provider name (acceptable while /capabilities route is pending)
const result = await queryCapability("my-rag-app", "POST /query", {
  question: userQuery,
  match_count: 5,
});

// Future: fully dynamic
const provider = await resolveProvider("hybrid_search");
if (!provider) throw new Error("No search provider available");
const result = await queryCapability(provider, "POST /query", { question: userQuery });
```

**Python equivalent:**

```python
import httpx

WORKBENCH_API = os.environ.get("WORKBENCH_API", "http://mcp-server:3100")

def query_capability(provider_project: str, endpoint: str, body: dict) -> dict:
    method, path = endpoint.split(" ", 1)
    resp = httpx.request(
        method,
        f"{WORKBENCH_API}{path}",
        json=body,
        headers={"X-Project": provider_project},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()

# Usage
result = query_capability("my-rag-app", "POST /query", {"question": user_query})
```

---

### Step 4b — Async routing (Message Bus)

Use the bus when: the producer doesn't need to wait for a result, multiple consumers may be interested, or the work is long-running.

**Bus channel naming convention:**
```
<capability-token>:<event>

Examples:
  document_ingestion:complete    — a document finished ingesting
  document_ingestion:failed      — an ingest job failed
  hybrid_search:result           — a search result is ready
  agent_reasoning:decision       — an agent made a decision
  data_transform:stage_complete  — a pipeline stage finished
```

For high-traffic channels, namespace with the project name:
```
my-pipeline:document_ingestion:complete
```

**Producer (data-pipeline project ingests, notifies RAG project):**

```python
# After successfully ingesting a document
from workbench_client import bus_publish

await bus_publish("document_ingestion:complete", {
    "filepath": str(path),
    "document_id": doc_id,
    "project": "my-rag-app",    # hint to consumer about which project to notify
    "metadata": {"source": "pipeline", "timestamp": time.time()},
})
```

Or via HTTP:
```bash
curl -s -X POST http://localhost:3100/bus/publish \
  -H "Content-Type: application/json" \
  -H "X-Project: my-pipeline" \
  -d '{"channel": "document_ingestion:complete", "payload": {"filepath": "/workspace/documents/report.pdf"}}'
```

**Consumer (RAG project polls for new ingest jobs):**

```bash
# Read up to 10 pending messages from the channel
curl -s -X POST http://localhost:3100/bus/read \
  -H "Content-Type: application/json" \
  -H "X-Project: my-rag-app" \
  -d '{"channel": "document_ingestion:complete", "count": 10}'
```

```typescript
// Background worker pattern in a consuming project
async function processIngestQueue() {
  while (true) {
    const res = await fetch(`${WORKBENCH_API}/bus/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Project": "my-rag-app" },
      body: JSON.stringify({ channel: "document_ingestion:complete", count: 10 }),
    });
    const { messages } = await res.json();
    for (const msg of messages ?? []) {
      await ingestDocument(msg.payload.filepath);
    }
    await new Promise(r => setTimeout(r, 5000)); // poll every 5s
  }
}
```

---

## Patterns

### Pattern A — Peer Projects (lifecycle independence)

```
┌──────────────────┐  X-Project: my-rag-app   ┌───────────────────┐
│   my-app         │ ────── POST /query ──────► │   mcp-server:3100  │
│ consumes:        │ ◄──── search results ───── │   routes to        │
│  hybrid_search   │                            │   my-rag-app DB    │
└──────────────────┘                            └───────────────────┘
                                                         │
                                                ┌────────▼──────────┐
                                                │   my-rag-app DB   │
                                                │   (pgvector)      │
                                                └───────────────────┘
```

Each project has its own database and lifecycle. The consumer never knows how search is implemented — only that someone provides `hybrid_search`.

```bash
# Setup
make add-capability NAME=my-rag-app CAPABILITY=rag
make add-capability NAME=my-app CAPABILITY=agent     # agent consumes hybrid_search
```

### Pattern B — Additive (shared lifecycle)

```bash
# Add RAG directly to my-app — same project, same database
make add-capability NAME=my-app CAPABILITY=rag
```

Simpler. The app's own database is the knowledgebase. Use when the search index is specific to this app and doesn't need to be shared or independently managed.

### Pattern C — Event-Driven Pipeline

```
data-pipeline ──► bus: document_ingestion:complete ──► rag-project
                                                    └──► notification-service
                                                    └──► audit-logger
```

Neither the pipeline nor the rag-project knows the other exists. Adding a new consumer requires zero changes to existing projects — just subscribe to the channel.

```bash
# Pipeline publishes
curl -X POST http://localhost:3100/bus/publish -H "X-Project: my-pipeline" \
  -d '{"channel": "document_ingestion:complete", "payload": {...}}'

# RAG project polls (or use SSE for real-time)
curl -X POST http://localhost:3100/bus/read -H "X-Project: my-rag-app" \
  -d '{"channel": "document_ingestion:complete", "count": 10}'

# Real-time SSE stream
curl http://localhost:3100/bus/document_ingestion:complete/stream -H "X-Project: my-rag-app"
```

### Pattern D — Agent as Coordinator

When routing logic needs business rules (prefer project A for code queries, project B for general), an agent plays the coordinator role:

```python
# Agent tool: route_search
async def route_search(query: str, context: str) -> dict:
    # Discover providers
    providers = get_projects_providing("hybrid_search")

    # Apply routing logic
    provider = select_provider(providers, query=query, context=context)

    # Call the chosen provider
    return query_capability(provider, "POST /query", {"question": query})
```

This is Option 2 from `docs/21-elixir-channel-project-type-composition.md` — flexible, adds latency, requires the agent to be always-on.

---

## Capability Token Vocabulary

All tokens defined in `templates/<type>/capability.json`. Use these exact strings:

| Token | Provided by | What it implies |
|-------|------------|-----------------|
| `hybrid_search` | rag | `POST /query` → ranked results |
| `document_ingestion` | rag | `POST /ingest` → chunks + embeds |
| `search_eval` | rag | `POST /eval` → MRR + quality scores |
| `knowledgebase` | rag | persistent vector store available |
| `agent_reasoning` | agent, multi-agent | LLM-driven decision loop |
| `tool_use` | agent | structured tool call/response cycle |
| `agent_memory` | agent | `PUT/GET /memory/:key` |
| `agent_eval` | agent, multi-agent | `POST /agent-eval` → behavioral scores |
| `multi_agent_coord` | multi-agent | team orchestration patterns |
| `message_bus` | multi-agent | `POST /bus/publish`, `POST /bus/read` |
| `rest_api` | fullstack, microservices | HTTP API surface |
| `web_interface` | fullstack | rendered UI |
| `user_auth` | fullstack | authenticated user context |
| `relational_store` | fullstack | structured SQL database |
| `offline_support` | pwa | service worker + cache |
| `push_notifications` | pwa | VAPID push |
| `installable_web` | pwa | Web App Manifest |
| `cli_interface` | cli | terminal command surface |
| `data_transform` | data-pipeline | ETL stage execution |
| `stream_processing` | data-pipeline | streaming record processing |
| `incremental_load` | data-pipeline | idempotent delta loads |
| `sensor_data` | iot | hardware sensor readings |
| `ros2_nodes` | iot | ROS2 topic/service/action graph |
| `mqtt_messaging` | iot | MQTT pub/sub |
| `edge_deployment` | iot | ARM Docker + systemd |
| `infrastructure_as_code` | microservices | Terraform modules |
| `distributed_tracing` | microservices | OTel spans across services |
| `service_mesh` | microservices | inter-service comms + retry |
| `embedding_service` | (consumed by rag) | vector embedding API |
| `llm_api` | (consumed by agent) | LLM inference API |

To add a new token: define it in `capability.json` and document it here.

---

## Checklist

- [ ] Both projects registered: `make list-projects` shows both
- [ ] Provider has the token in its `provides[]`: `make show-capability CAPABILITY=<type>` or check project config
- [ ] Consumer has the token in its `consumes[]`
- [ ] Sync calls use `X-Project: <provider-name>` header — not a separate base URL
- [ ] Async calls use the standard channel naming: `<token>:<event>`
- [ ] `callCapability()` / `query_capability()` helper created in consuming project — not raw fetch scattered everywhere
- [ ] `required: false` declared for capabilities with graceful fallbacks
- [ ] Pattern chosen matches lifecycle needs (A for independence, B for simplicity, C for fan-out)

---

## Files Involved

| File | Action |
|------|--------|
| Project config (via API or `make add-capability`) | Update `provides`, `consumes`, `capabilities` arrays |
| `src/lib/capability-client.ts` or `lib/capability_client.py` | Create — resolver + typed HTTP caller |
| Any route/handler calling a peer project | Create or update — use capability client, not raw fetch |
| `.workbench/capability-map.md` | Create (optional) — document which project provides what for this system |

---

## Common Mistakes

**Using port 3200.** That's Grafana. The MCP server and all project endpoints are at port 3100.

**Hardcoding the provider project name in multiple places.** Create `capability-client.ts` once and call `queryCapability(SEARCH_PROVIDER, ...)`. When the provider changes, update one constant.

**Forgetting `X-Project`.** Without it, the request hits the default project (usually `workbench-source`). The response will be empty or wrong. Always pass `X-Project: <provider-name>`.

**Using vague capability tokens.** `"search"` is not a token — `"hybrid_search"` is. Vague tokens don't imply a contract, breaking LSP. See the token vocabulary above; if yours isn't there, add it to `capability.json` and this table.

**Merging lifecycle-dependent capabilities into Pattern B.** If you need to rebuild or reindex the knowledgebase without redeploying the app, they must be separate projects (Pattern A). Pattern B shares the database lifecycle.

**Bus channel naming collisions.** Two projects publishing to `ingest:complete` without a namespace will mix each other's messages. Use `<project-name>:ingest:complete` for project-specific events.

**Not declaring `consumes`.** The registry has no way to detect mismatches unless you declare them. Always declare `consumes` even when currently using Pattern B — it documents the dependency and makes a future split to Pattern A straightforward.

---

## Related Docs

| Doc | What it adds |
|-----|-------------|
| `docs/23-design-principles-guide.md` | Why this model is designed this way — DIP, LSP, monoid/functor framing |
| `docs/21-elixir-channel-project-type-composition.md` | Elixir analogy, full provides/consumes schema options, coordinator variants |
| `templates/_base/skills/INDEX.md` | All capabilities with contract links — the discovery layer |
| `templates/<type>/capability.json` | Per-type contracts — source of truth for tokens, tools, skills |
| `infra/scripts/add-capability.sh` | How capabilities are injected into project config |
