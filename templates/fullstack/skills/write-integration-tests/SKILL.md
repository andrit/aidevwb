---
name: write-integration-tests
description: Write integration tests for API endpoints — test setup, database seeding, HTTP requests against a real DB, and teardown
domain: backend
type: fullstack
triggers:
  - "write integration tests"
  - "test the API"
  - "test the endpoint"
  - "test with a real database"
  - "end-to-end test"
  - "API test"
  - "test the route"
  - "integration test setup"
---

# Write Integration Tests

## When to use

When you need to test API endpoints against a real database (not mocks). Integration tests catch the bugs that unit tests miss: wrong SQL, missing migrations, schema mismatches, and transaction edge cases. Activate when the user says "test the POST /posts endpoint", "write integration tests", or "test with a real database".

## Prerequisites

- Test database available (either a dedicated test DB or the dev DB — see setup below)
- Vitest configured (`vite.config.ts` with `environment: "node"` — NOT jsdom for server tests)
- Fastify app can be instantiated without starting a real HTTP listener
- `DATABASE_URL` or equivalent env var available in the test environment

## Steps

### 1. Configure Vitest for server-side tests

```ts
// vite.config.ts (or vitest.config.ts)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",              // NOT jsdom — these are server tests
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15000,               // DB operations can be slow
    pool: "forks",                    // isolates DB connections between test files
    poolOptions: { forks: { singleFork: true } },  // run files sequentially to avoid DB conflicts
  },
});
```

### 2. Create the test setup file

```ts
// src/test/setup.ts
import { getTestDb, cleanTestDb } from "./db";

// Run before ALL tests in this suite
beforeAll(async () => {
  const db = await getTestDb();
  await db.query("BEGIN");   // optional: wrap entire suite in a transaction
});

// Clean up between tests (faster than dropping/recreating the schema)
afterEach(async () => {
  await cleanTestDb();
});

afterAll(async () => {
  const db = await getTestDb();
  await db.end();
});
```

### 3. Set up the test database helper

```ts
// src/test/db.ts
import postgres from "postgres";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;

let db: ReturnType<typeof postgres> | null = null;

export function getTestDb() {
  if (!db) db = postgres(TEST_DB_URL, { max: 5 });
  return db;
}

// Truncate all test data between tests — faster than DROP/CREATE
export async function cleanTestDb() {
  const db = getTestDb();
  await db`TRUNCATE posts, users RESTART IDENTITY CASCADE`;
}

// Seed helper — creates a user and returns it
export async function seedUser(overrides: Partial<{ email: string; role: string }> = {}) {
  const db = getTestDb();
  const [user] = await db`
    INSERT INTO users (email, password_hash, role)
    VALUES (
      ${overrides.email ?? "test@example.com"},
      '$2b$12$placeholderHashForTestingOnly',
      ${overrides.role ?? "user"}
    )
    RETURNING id, email, role
  `;
  return user;
}

// Seed helper — creates a post
export async function seedPost(authorId: string, overrides: Partial<{ title: string; status: string }> = {}) {
  const db = getTestDb();
  const [post] = await db`
    INSERT INTO posts (title, content, author_id, status)
    VALUES (
      ${overrides.title ?? "Test Post"},
      'Test content',
      ${authorId},
      ${overrides.status ?? "draft"}
    )
    RETURNING id, title, content, author_id AS "authorId", status, created_at AS "createdAt"
  `;
  return post;
}
```

### 4. Create a test app factory

Tests need a Fastify instance without a running HTTP server. Create a factory that builds the app with a test DB.

```ts
// src/test/app.ts
import Fastify from "fastify";
import { registerRoutes } from "../routes";
import { getTestDb } from "./db";

export async function buildTestApp() {
  const fastify = Fastify({ logger: false });   // disable logging in tests
  const db = getTestDb();

  await registerRoutes(fastify, db);
  await fastify.ready();

  return fastify;
}
```

### 5. Write the integration test

```ts
// src/__tests__/routes/posts.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { buildTestApp } from "../../test/app";
import { cleanTestDb, seedUser, seedPost } from "../../test/db";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterEach(async () => {
  await cleanTestDb();
});

afterAll(async () => {
  await app.close();
});

// ── POST /posts ──────────────────────────────────────────────────────────────

describe("POST /posts", () => {
  it("creates a post and returns 201", async () => {
    const user = await seedUser();

    const response = await app.inject({
      method: "POST",
      url: "/posts",
      payload: {
        title: "Hello World",
        content: "This is my first post.",
        authorId: user.id,
      },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe("Hello World");
    expect(body.authorId).toBe(user.id);
    expect(body.status).toBe("draft");         // default
    expect(body.createdAt).toBeDefined();
  });

  it("returns 400 when title is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/posts",
      payload: { content: "No title here", authorId: "fake-id" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when title exceeds 200 chars", async () => {
    const user = await seedUser();
    const response = await app.inject({
      method: "POST",
      url: "/posts",
      payload: { title: "x".repeat(201), content: "ok", authorId: user.id },
    });

    expect(response.statusCode).toBe(400);
  });
});

// ── GET /posts/:id ───────────────────────────────────────────────────────────

describe("GET /posts/:id", () => {
  it("returns the post when it exists", async () => {
    const user = await seedUser();
    const post = await seedPost(user.id, { title: "Seeded Post" });

    const response = await app.inject({
      method: "GET",
      url: `/posts/${post.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().title).toBe("Seeded Post");
  });

  it("returns 404 for unknown id", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/posts/00000000-0000-0000-0000-000000000000",
    });

    expect(response.statusCode).toBe(404);
  });
});

// ── DELETE /posts/:id ────────────────────────────────────────────────────────

describe("DELETE /posts/:id", () => {
  it("deletes an existing post", async () => {
    const user = await seedUser();
    const post = await seedPost(user.id);

    const deleteRes = await app.inject({ method: "DELETE", url: `/posts/${post.id}` });
    expect(deleteRes.statusCode).toBe(204);

    const getRes = await app.inject({ method: "GET", url: `/posts/${post.id}` });
    expect(getRes.statusCode).toBe(404);
  });
});
```

### 6. Test authenticated endpoints

```ts
// Helper: get a JWT for a test user
async function getAuthToken(app: FastifyInstance, email = "auth@example.com") {
  await seedUser({ email });
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password: "password123" },
  });
  return res.json<{ accessToken: string }>().accessToken;
}

describe("GET /profile (protected)", () => {
  it("returns user profile when authenticated", async () => {
    const token = await getAuthToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/profile",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe("auth@example.com");
  });

  it("returns 401 when no token provided", async () => {
    const res = await app.inject({ method: "GET", url: "/profile" });
    expect(res.statusCode).toBe(401);
  });
});
```

### 7. Run the integration tests

```bash
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/test_db npx vitest run
# or with the workbench:
make up && npx vitest run
```

## Templates

### Seed factory pattern (for many test entities)

```ts
// src/test/factories.ts
let counter = 0;

export function makePost(overrides = {}) {
  counter++;
  return {
    title: `Post ${counter}`,
    content: `Content for post ${counter}`,
    status: "draft" as const,
    ...overrides,
  };
}

// Usage:
const post = await seedPost(user.id, makePost({ status: "published" }));
```

### Inject with JSON body (shorthand)

```ts
const res = await app.inject({
  method: "POST",
  url: "/items",
  payload: { name: "widget" },   // Fastify inject sets Content-Type automatically
});
```

## Checklist

- [ ] `environment: "node"` in Vitest config (not `jsdom`)
- [ ] `testTimeout` set to 15000+ (DB ops are slow)
- [ ] `afterEach` truncates tables — not `beforeEach` (lets you inspect state on failure)
- [ ] `afterAll` closes the DB connection and Fastify instance
- [ ] Seed helpers used for setup — no hardcoded UUIDs that might not exist
- [ ] Each test is independent — no shared mutable state between tests
- [ ] `app.inject()` used — no `supertest`, no real HTTP port
- [ ] Tests cover: happy path, validation errors (400), not-found (404), auth (401/403)
- [ ] `npx vitest run` passes with a real database running

## Files involved

| File | Action |
|------|--------|
| `vite.config.ts` | Set `environment: "node"`, `testTimeout`, `pool` |
| `src/test/setup.ts` | `afterEach` cleanup + `afterAll` teardown |
| `src/test/db.ts` | `getTestDb()`, `cleanTestDb()`, seed helpers |
| `src/test/app.ts` | `buildTestApp()` factory |
| `src/__tests__/routes/<domain>.test.ts` | Integration tests |

## Common mistakes

**Using `environment: "jsdom"` for server tests** — jsdom is for browser tests. API tests need `environment: "node"`.

**Shared state between tests** — each test should start clean. The `afterEach(() => cleanTestDb())` pattern ensures this. Never rely on data created in a previous test.

**Hardcoded IDs in seeds** — if you hardcode `authorId: "abc123"`, the test fails if that user doesn't exist. Always create dependencies via seed helpers and capture their returned IDs.

**Not closing Fastify in `afterAll`** — open handles keep Vitest from exiting cleanly. Always `await app.close()` in `afterAll`.

**Testing the whole app through HTTP** — `app.inject()` bypasses the network entirely and is faster and more reliable than spinning up a real port with `supertest`. Prefer it for unit/integration tests; reserve real HTTP for smoke tests.

**`TRUNCATE` without `CASCADE`** — if tables have foreign key relationships, `TRUNCATE posts` fails if `post_comments` still references posts. Always use `TRUNCATE ... CASCADE` or list tables in dependency order.
