---
name: lang-typescript
description: Strict TypeScript with Zod runtime validation, utility types, tsconfig best practices, and typed MCP tool response patterns for workbench projects
domain: language
type: cross-cutting
triggers:
  - "typescript"
  - "ts"
  - "Zod"
  - "strict types"
  - "tsconfig"
  - "type safety"
  - "runtime validation"
---

# TypeScript (Strict + Zod)

## When to use

Use this skill when adding TypeScript to a project or when the workbench MCP server codebase itself is being extended. Covers strict tsconfig setup, Zod as the single source of truth for both runtime and compile-time types, utility type patterns for common transformations, and how to correctly type async functions that call the workbench API. The MCP server itself (`apps/mcp-server/`) is the canonical reference implementation.

## Prerequisites

- Node.js 20+
- `npm install typescript zod` (or `npm install --save-dev typescript` + `npm install zod`)
- `package.json` with `"type": "module"` for ESM projects

## tsconfig.json Template

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": false,
    "skipLibCheck": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Key flags explained:
- `noUncheckedIndexedAccess` — `arr[0]` returns `T | undefined`, not `T`. Forces you to handle missing elements.
- `exactOptionalPropertyTypes` — `{ x?: string }` means `x` is absent or a string, never `undefined`. Prevents `obj.x = undefined` silently clearing optional fields.
- `moduleResolution: NodeNext` — required for ESM with Node 20. Import paths must include `.js` extension even for `.ts` source files.

## Zod: Schema-First Types

Zod schemas are the single source of truth. Never write a separate `interface` or `type` that duplicates a Zod schema — derive the TypeScript type from it:

```ts
// src/schemas/document.ts
import { z } from 'zod';

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  projectName: z.string().min(1),
  url: z.string().url(),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});

// Derived type — NOT a separate interface
export type Document = z.infer<typeof DocumentSchema>;

// Partial for update operations
export const DocumentUpdateSchema = DocumentSchema.partial().omit({ id: true, createdAt: true });
export type DocumentUpdate = z.infer<typeof DocumentUpdateSchema>;

// Input type (before DB assigns id/createdAt)
export const DocumentInputSchema = DocumentSchema.omit({ id: true, createdAt: true });
export type DocumentInput = z.infer<typeof DocumentInputSchema>;
```

### Parsing vs Asserting

```ts
// PARSE — throws ZodError with field-level messages if invalid (use at boundaries)
const doc = DocumentSchema.parse(unknownData);

// SAFE PARSE — returns { success, data } or { success: false, error } (use when you want to handle errors)
const result = DocumentSchema.safeParse(unknownData);
if (!result.success) {
  console.error(result.error.flatten().fieldErrors);
  return;
}
const doc = result.data; // fully typed

// ASSERT — no-op at runtime, only compile-time (use inside tests, never in production code)
const doc = data as Document; // AVOID — skips runtime validation
```

## Typing MCP Tool Responses

The workbench MCP server returns JSON. Type those responses with Zod so you get both runtime safety and TypeScript types:

```ts
// src/lib/workbench-client.ts
import { z } from 'zod';

const BASE = process.env.MCP_SERVER_URL ?? 'http://mcp-server:3100';

// Generic typed fetch
async function apiFetch<T extends z.ZodTypeAny>(
  schema: T,
  path: string,
  init?: RequestInit
): Promise<z.infer<T>> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(body['message'] ?? `HTTP ${res.status}`));
  }
  return schema.parse(await res.json());
}

// Response schemas
const QueryResultSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    content: z.string(),
    score: z.number(),
    metadata: z.record(z.unknown()).optional(),
  })),
  total: z.number(),
});

const MemorySchema = z.object({
  key: z.string(),
  value: z.string(),
  createdAt: z.string(),
});

// Typed API methods
export async function queryKnowledge(project: string, q: string, limit = 5) {
  return apiFetch(
    QueryResultSchema,
    `/projects/${project}/query`,
    { method: 'POST', body: JSON.stringify({ query: q, limit }) }
  );
}

export async function recallMemory(project: string, key: string) {
  return apiFetch(
    MemorySchema,
    `/projects/${project}/memories/${encodeURIComponent(key)}`
  );
}
```

## Utility Types for Common Patterns

```ts
// Make specific keys required in an otherwise-partial type
type WithRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

// Strip null/undefined from a type recursively (useful for DB row types)
type DeepNonNullable<T> = {
  [K in keyof T]: NonNullable<T[K]> extends object
    ? DeepNonNullable<NonNullable<T[K]>>
    : NonNullable<T[K]>;
};

// Extract the resolved type of a Promise
type Awaited<T> = T extends Promise<infer U> ? U : T; // built-in since TS 4.5

// Narrow discriminated unions
type ApiResponse<T> =
  | { status: 'ok'; data: T }
  | { status: 'error'; message: string };

function handleResponse<T>(res: ApiResponse<T>): T {
  if (res.status === 'error') throw new Error(res.message);
  return res.data; // TypeScript narrows to { status: 'ok'; data: T }
}
```

## Type Guards

Prefer Zod's `safeParse` over manual type guards. When you must write one, document what it's checking:

```ts
// ✅ Use Zod safeParse for most cases
function isDocument(v: unknown): v is Document {
  return DocumentSchema.safeParse(v).success;
}

// ✅ Manual guard when the check is a single discriminant
function isErrorResponse(v: unknown): v is { error: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'error' in v &&
    typeof (v as { error: unknown }).error === 'string'
  );
}
```

## Async Function Typing

```ts
// Always declare the return type of async functions that call external services
async function getChunks(
  project: string,
  query: string
): Promise<QueryResult[]> {
  const res = await queryKnowledge(project, query);
  return res.results;
}

// For functions that can fail without throwing, use a discriminated union
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

async function safeQuery(
  project: string,
  q: string
): Promise<Result<QueryResult[]>> {
  try {
    const res = await queryKnowledge(project, q);
    return { ok: true, value: res.results };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
```

## Checklist

- [ ] `tsconfig.json` has `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
- [ ] All schemas defined with Zod; TypeScript types derived via `z.infer<>`, never duplicated
- [ ] All `unknown` inputs parsed with `schema.parse()` or `schema.safeParse()` before use
- [ ] External API responses typed via Zod schemas (including workbench API calls)
- [ ] No `as SomeType` casts at runtime boundaries — only safe narrowing
- [ ] Import paths include `.js` extension when using `moduleResolution: NodeNext`
- [ ] `npx tsc --noEmit` passes with zero errors before committing

## Files involved

| File | Action |
|------|--------|
| `tsconfig.json` | Create: strict compiler options |
| `src/schemas/*.ts` | Create: Zod schemas + derived types |
| `src/schemas/index.ts` | Create: re-export all schemas |
| `src/lib/workbench-client.ts` | Create: typed MCP server fetch client |
| `src/services/*.ts` | Create: domain logic with explicit return types |

## Common mistakes

**Separate `interface` that duplicates a Zod schema** — when the schema changes, the interface goes stale. Use only `z.infer<typeof Schema>`. Search for `interface` declarations that mirror schema field names — they're drift waiting to happen.

**`moduleResolution: NodeNext` without `.js` extensions in imports** — `import { foo } from './utils'` fails at runtime with NodeNext. TypeScript resolves `utils.ts` but Node loads `utils.js`. Write `import { foo } from './utils.js'` even though the file is `utils.ts`.

**`as unknown as SomeType` double-cast** — this is a type system escape hatch that produces zero runtime safety. If you need it, add a Zod parse call instead. The double-cast pattern usually hides a missing schema.

**Ignoring `noUncheckedIndexedAccess` errors by adding `!`** — `arr[0]!` silences the error but reintroduces the bug. Handle the `| undefined` case explicitly: `const first = arr[0]; if (first === undefined) return;`.

**Putting business logic in schema files** — schemas define shape, not behavior. Keep transform logic (`z.transform(...)`) minimal; heavy processing belongs in services. Schema files imported by tests should have zero side effects.
