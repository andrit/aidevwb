---
name: lang-javascript
description: ES2022+ patterns for Node.js projects — ESM modules, async/await, error handling, and fetch-based integration with the workbench MCP server API
domain: language
type: cross-cutting
triggers:
  - "javascript"
  - "js"
  - "node.js"
  - "ESM"
  - "async await"
  - "node script"
  - "javascript agent"
---

# JavaScript (ES2022+ / Node.js)

## When to use

Use this skill when building Node.js services, scripts, or agents in the workbench. Covers modern ESM module setup, async/await patterns with proper error handling, and the fetch-based pattern for calling the workbench MCP server at `http://mcp-server:3100`. Apply when the project type is `cli`, `agent`, or `custom` and the language is JavaScript.

## Prerequisites

- Node.js 20+ (available in the workbench `claude-code` container)
- `package.json` with `"type": "module"` for ESM
- MCP server running (`make up`) if calling workbench APIs

## Project Setup

### package.json

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "node --test src/**/*.test.js"
  },
  "dependencies": {
    "zod": "^3.22.0"
  }
}
```

Key point: `"type": "module"` makes every `.js` file an ES module. Use `.cjs` extension for any CommonJS files you must include.

## Core Patterns

### Async/Await with Explicit Error Handling

Never let unhandled promise rejections crash silently. Use a `Result` pattern or structured try/catch at boundaries:

```js
// lib/result.js — lightweight Result type (no dependencies)
export const ok = (value) => ({ ok: true, value });
export const err = (error) => ({ ok: false, error });

// service that returns Result instead of throwing
export async function fetchDocument(projectName, docId) {
  try {
    const res = await fetch(
      `http://mcp-server:3100/projects/${projectName}/documents/${docId}`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return err(new Error(body.message ?? `HTTP ${res.status}`));
    }
    return ok(await res.json());
  } catch (cause) {
    return err(new Error('Network error', { cause }));
  }
}

// caller — no try/catch noise at the top level
const result = await fetchDocument('my-project', 'doc-123');
if (!result.ok) {
  console.error('Failed:', result.error.message);
  process.exit(1);
}
console.log(result.value);
```

### Top-Level Await Entry Point

```js
// src/index.js
import { run } from './app.js';

// Catch unhandled rejections that escape the Result pattern
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

await run();
```

### Module Structure

```
src/
├── index.js          — entry point, wires up dependencies
├── app.js            — main logic
├── lib/
│   ├── result.js     — Result type helpers
│   └── workbench.js  — MCP server client (see below)
├── services/
│   └── *.js          — domain logic, receives clients as params
└── *.test.js         — co-located or mirrored tests
```

## Workbench MCP Server Client

The MCP server exposes a REST API at `http://mcp-server:3100`. Use this client inside the workbench Docker network:

```js
// lib/workbench.js
import { ok, err } from './result.js';

const BASE = process.env.MCP_SERVER_URL ?? 'http://mcp-server:3100';

async function request(method, path, body) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, init);
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    return err(new Error(json?.message ?? `HTTP ${res.status} ${path}`));
  }
  return ok(json);
}

// --- RAG ---
export const ingest = (project, url, tags = []) =>
  request('POST', `/projects/${project}/ingest`, { url, tags });

export const query = (project, q, limit = 5) =>
  request('POST', `/projects/${project}/query`, { query: q, limit });

// --- Memory ---
export const remember = (project, key, value) =>
  request('POST', `/projects/${project}/memories`, { key, value });

export const recall = (project, key) =>
  request('GET', `/projects/${project}/memories/${encodeURIComponent(key)}`);

// --- Message Bus ---
export const publish = (project, channel, payload) =>
  request('POST', `/projects/${project}/bus/publish`, { channel, payload });

export const readBus = (project, channel, limit = 10) =>
  request('GET', `/projects/${project}/bus/${channel}?limit=${limit}`);
```

### Usage Example

```js
// services/knowledge.js
import { query, remember } from '../lib/workbench.js';

export async function answerFromKnowledge(project, question) {
  const result = await query(project, question);
  if (!result.ok) throw result.error;

  const chunks = result.value.results ?? [];
  if (chunks.length === 0) return null;

  // Cache the question for later analysis
  await remember(project, `last_query:${Date.now()}`, question);

  return chunks.map((c) => c.content).join('\n\n');
}
```

## Streaming / Long-Running Tasks

Use `AsyncGenerator` for tasks that produce output incrementally:

```js
// lib/stream.js
export async function* processItems(items, handler) {
  for (const item of items) {
    const result = await handler(item);
    yield result;
  }
}

// caller
for await (const result of processItems(docs, processDoc)) {
  console.log(result.id, result.status);
}
```

## Node.js Built-in Test Runner

Node 20+ has a built-in test runner — no Jest or Vitest needed for simple scripts:

```js
// src/lib/result.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ok, err } from './result.js';

describe('Result helpers', () => {
  test('ok wraps a value', () => {
    const r = ok(42);
    assert.equal(r.ok, true);
    assert.equal(r.value, 42);
  });

  test('err wraps an error', () => {
    const r = err(new Error('boom'));
    assert.equal(r.ok, false);
    assert.match(r.error.message, /boom/);
  });
});
```

Run with: `node --test src/**/*.test.js`

## Checklist

- [ ] `package.json` has `"type": "module"` for ESM
- [ ] Entry point uses `process.on('unhandledRejection', ...)` guard
- [ ] All async functions return `Result` or throw at module boundaries — no silent failures
- [ ] `workbench.js` client reads `MCP_SERVER_URL` from env (defaults to `http://mcp-server:3100`)
- [ ] No `require()` calls — use `import` everywhere
- [ ] Dynamic imports (`await import(...)`) used for conditional/lazy loading only
- [ ] Tests co-located or in `src/__tests__/` using Node built-in runner

## Files involved

| File | Action |
|------|--------|
| `package.json` | Create: set `"type": "module"`, scripts, dependencies |
| `src/index.js` | Create: entry point with unhandledRejection guard |
| `src/lib/result.js` | Create: Result type helpers |
| `src/lib/workbench.js` | Create: MCP server fetch client |
| `src/services/*.js` | Create: domain logic modules |

## Common mistakes

**Mixing CJS and ESM** — once you set `"type": "module"`, `require()` is unavailable in `.js` files. If a dependency only ships CJS, import it via `createRequire` or find the ESM version. The error `require is not defined in ES module scope` means you have a `require()` call somewhere.

**Missing `await` on async calls that return Results** — `const result = fetchDocument(...)` (no await) gives you a Promise, not a Result. The `result.ok` check then always sees `undefined`. Always `await` before checking.

**Hardcoding `localhost:3100` instead of `mcp-server:3100`** — inside Docker, the container hostname is `mcp-server`. `localhost` won't resolve to the MCP container. Use `http://mcp-server:3100` inside the network, or `http://localhost:3100` only when calling from the host machine.

**No error handling on `fetch`** — `fetch` throws on network failure but returns a non-ok Response on HTTP errors. Always check `res.ok` before calling `res.json()`. The workbench client pattern above handles both cases.

**Top-level `await` in files imported by other modules** — top-level `await` in a non-entry module blocks the entire module graph load. Keep top-level `await` only in `index.js`; initialize async resources lazily or pass them in as parameters.
