---
name: add-api-endpoint
description: Add a new REST API endpoint — schema, service, route handler, registration, and tests — following the DDD/TDD pattern used by this workbench
domain: backend
type: fullstack
triggers:
  - "add an API endpoint"
  - "add a route"
  - "new endpoint"
  - "add a REST API"
  - "create a POST/GET/PUT/DELETE route"
  - "add a handler"
---

# Add an API Endpoint

## When to use

When adding any new HTTP endpoint to the server. Follows the DDD layer order: schema → service → route → register → test. Activate when the user says "add an endpoint for X", "create a route to do Y", or "I need a POST /api/Z".

## Prerequisites

- Fastify + Zod + TypeScript project (as scaffolded by this workbench)
- `src/schemas/index.ts`, `src/routes/index.ts`, and `src/services/` exist
- `npx tsc --noEmit` passes before you start

## Steps

### 1. Define the schema

Create or add to `src/schemas/<domain>.ts`. Schemas are the single source of truth — TypeScript types, HTTP validation, and error messages all come from here.

```ts
// src/schemas/post.ts
import { z } from "zod";

export const CreatePostBody = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  authorId: z.string().uuid(),
});

export const PostResponse = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  authorId: z.string().uuid(),
  createdAt: z.string().datetime(),
});

export const PostParams = z.object({
  id: z.string().uuid(),
});

export type CreatePostBody = z.infer<typeof CreatePostBody>;
export type PostResponse = z.infer<typeof PostResponse>;
```

Re-export from `src/schemas/index.ts`:

```ts
export * from "./post";
```

### 2. Implement the service function

Business logic lives in `src/services/<domain>.ts`. The function receives `db` as its first parameter (dependency injection — never import a global `db` singleton).

```ts
// src/services/posts.ts
import { Db } from "./db";
import { CreatePostBody, PostResponse } from "../schemas/post";

export async function createPost(db: Db, body: CreatePostBody): Promise<PostResponse> {
  const result = await db.query<PostResponse>(
    `INSERT INTO posts (title, content, author_id)
     VALUES ($1, $2, $3)
     RETURNING id, title, content, author_id AS "authorId", created_at AS "createdAt"`,
    [body.title, body.content, body.authorId]
  );
  return result.rows[0];
}

export async function getPost(db: Db, id: string): Promise<PostResponse | null> {
  const result = await db.query<PostResponse>(
    `SELECT id, title, content, author_id AS "authorId", created_at AS "createdAt"
     FROM posts WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}
```

### 3. Write the route handler

Route handlers live in `src/routes/<domain>.ts`. They validate with Zod, call services, and return results. No business logic here.

```ts
// src/routes/posts.ts
import { FastifyInstance } from "fastify";
import { Db } from "../services/db";
import { CreatePostBody, PostParams, PostResponse } from "../schemas/post";
import { createPost, getPost } from "../services/posts";
import { zodToJsonSchema } from "zod-to-json-schema";

export function registerPostRoutes(fastify: FastifyInstance, db: Db) {
  // POST /posts
  fastify.post("/posts", {
    schema: {
      body: zodToJsonSchema(CreatePostBody),
      response: { 201: zodToJsonSchema(PostResponse) },
    },
  }, async (request, reply) => {
    const body = CreatePostBody.parse(request.body);
    const post = await createPost(db, body);
    return reply.status(201).send(post);
  });

  // GET /posts/:id
  fastify.get<{ Params: { id: string } }>("/posts/:id", {
    schema: {
      params: zodToJsonSchema(PostParams),
      response: { 200: zodToJsonSchema(PostResponse) },
    },
  }, async (request, reply) => {
    const { id } = PostParams.parse(request.params);
    const post = await getPost(db, id);
    if (!post) return reply.status(404).send({ error: "Post not found" });
    return post;
  });
}
```

### 4. Register the route

Add to `src/routes/index.ts` inside the appropriate registration function:

```ts
// src/routes/index.ts
import { registerPostRoutes } from "./posts";

export function registerProjectScopedRoutes(fastify: FastifyInstance, db: Db) {
  // existing routes...
  registerPostRoutes(fastify, db);
}
```

### 5. Write tests

Test pure service functions directly. Test route handlers via the Fastify test client. Both should pass before merging.

```ts
// src/__tests__/schemas/post.test.ts
import { describe, it, expect } from "vitest";
import { CreatePostBody, PostResponse } from "../../schemas/post";

describe("CreatePostBody", () => {
  it("accepts valid input", () => {
    const result = CreatePostBody.safeParse({
      title: "Hello",
      content: "World",
      authorId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = CreatePostBody.safeParse({ title: "", content: "x", authorId: "..." });
    expect(result.success).toBe(false);
  });
});
```

```ts
// src/__tests__/services/posts.test.ts — if service has pure logic, test it
// For DB-dependent services, test via schema + integration test (see write-integration-tests skill)
```

### 6. Type-check and run tests

```bash
cd apps/mcp-server   # or your project root
npx tsc --noEmit     # must pass with zero errors
npx vitest run       # all tests must pass
```

## Templates

### Minimal CRUD endpoint pair (list + create)

```ts
// Schema
export const CreateItemBody = z.object({ name: z.string().min(1) });
export const ItemResponse = z.object({ id: z.string().uuid(), name: z.string() });
export type CreateItemBody = z.infer<typeof CreateItemBody>;
export type ItemResponse = z.infer<typeof ItemResponse>;

// Service
export async function createItem(db: Db, body: CreateItemBody): Promise<ItemResponse> {
  const { rows } = await db.query<ItemResponse>(
    "INSERT INTO items (name) VALUES ($1) RETURNING id, name",
    [body.name]
  );
  return rows[0];
}

export async function listItems(db: Db): Promise<ItemResponse[]> {
  const { rows } = await db.query<ItemResponse>("SELECT id, name FROM items ORDER BY name");
  return rows;
}

// Route
export function registerItemRoutes(fastify: FastifyInstance, db: Db) {
  fastify.get("/items", async () => listItems(db));
  fastify.post("/items", async (req, reply) => {
    const body = CreateItemBody.parse(req.body);
    return reply.status(201).send(await createItem(db, body));
  });
}
```

### Error response shape (keep consistent)

```ts
// 400 validation error
reply.status(400).send({ error: "Validation failed", details: result.error.flatten() });

// 404 not found
reply.status(404).send({ error: "Post not found" });

// 409 conflict
reply.status(409).send({ error: "A post with this title already exists" });
```

## Checklist

- [ ] Schema defined in `src/schemas/<domain>.ts` and re-exported from `schemas/index.ts`
- [ ] Types exported as `type X = z.infer<typeof X>` (no separate interface files)
- [ ] Service function takes `db: Db` as first parameter
- [ ] Route handler contains no SQL or business logic — only parse + call service + return
- [ ] Route registered in `routes/index.ts`
- [ ] Schema tests added (`safeParse` with valid and invalid inputs)
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` passes

## Files involved

| File | Action |
|------|--------|
| `src/schemas/<domain>.ts` | Create (or add to existing) |
| `src/schemas/index.ts` | Add re-export |
| `src/services/<domain>.ts` | Create (or add function) |
| `src/routes/<domain>.ts` | Create (or add handler) |
| `src/routes/index.ts` | Register new route module |
| `src/__tests__/schemas/<domain>.test.ts` | Create schema tests |

## Common mistakes

**Business logic in route handlers** — SQL queries or multi-step logic belong in the service. Route handlers should be 5–15 lines: parse, call, reply.

**Importing a global `db` in services** — always pass `db` as a parameter. This enables testing, multi-project support, and dependency injection.

**Duplicating types** — define once in Zod, derive the TypeScript type with `z.infer`. Never write a separate `interface Post { ... }` that mirrors a Zod schema.

**Not re-exporting from `schemas/index.ts`** — other modules import from `"../schemas"`. If you forget the re-export, you'll get import errors elsewhere.

**Returning raw DB rows without mapping** — always alias snake_case columns to camelCase in SQL (`author_id AS "authorId"`) or map in the service. Never leak `author_id` into the API response.

**Skipping `zodToJsonSchema`** — Fastify uses JSON Schema for its built-in serialization/validation. Use `zodToJsonSchema(MySchema)` in the route's `schema` object to get request coercion and faster response serialization.
