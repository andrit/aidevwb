---
name: add-database-table
description: Add a new PostgreSQL table — migration file, schema/types, CRUD service functions, and seed data
domain: backend
type: fullstack
triggers:
  - "add a database table"
  - "new table"
  - "add a migration"
  - "create a table"
  - "add to the database"
  - "store X in the database"
---

# Add a Database Table

## When to use

When the data model needs a new table. Covers the full lifecycle: SQL migration → Zod schema → TypeScript types → service functions → seed data. Activate when the user says "add a table for X", "I need to store Y in the database", or "create a migration for Z".

## Prerequisites

- PostgreSQL database (via Docker Compose or hosted)
- Migration runner already exists (e.g., `runMigrations()` in `services/projects.ts`, or a migration tool like Flyway/Liquibase/Knex)
- Existing `src/schemas/` and `src/services/` directories
- `supabase/migrations/` directory (or equivalent migrations folder)

## Steps

### 1. Write the migration file

Name migrations with a zero-padded sequence number and descriptive slug. The filename determines execution order — gaps are fine, but never renumber existing files.

```sql
-- supabase/migrations/007_posts.sql

CREATE TABLE IF NOT EXISTS posts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  content     TEXT        NOT NULL,
  author_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on frequently queried columns
CREATE INDEX IF NOT EXISTS posts_author_id_idx ON posts(author_id);
CREATE INDEX IF NOT EXISTS posts_status_created_idx ON posts(status, created_at DESC);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

**Column design checklist:**
- Every table gets `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- Every table gets `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- Mutable tables get `updated_at` + trigger
- Foreign keys use `ON DELETE CASCADE` (child deleted with parent) or `ON DELETE RESTRICT` (block parent deletion) — choose deliberately
- Use `CHECK` constraints for enum-like values rather than a separate enum type (easier to migrate later)
- Use `JSONB` for flexible metadata instead of adding columns for every attribute

### 2. Register the migration

In `src/services/projects.ts` (or wherever `runMigrations()` reads the file list), add the new file:

```ts
// src/services/projects.ts
const MIGRATIONS = [
  "001_extensions.sql",
  "002_documents.sql",
  "003_chunks.sql",
  "004_hybrid_search.sql",
  "005_conversations.sql",
  "006_memory_eval.sql",
  "007_posts.sql",   // ← add here
];
```

### 3. Define the Zod schema

```ts
// src/schemas/post.ts
import { z } from "zod";

// DB row shape — used for SELECT results
export const Post = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  authorId: z.string().uuid(),
  status: z.enum(["draft", "published", "archived"]),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Input for creating a row
export const CreatePost = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  authorId: z.string().uuid(),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  metadata: z.record(z.unknown()).optional().default({}),
});

// Input for updating (all fields optional)
export const UpdatePost = CreatePost.partial().omit({ authorId: true });

// Query filters
export const PostFilters = z.object({
  authorId: z.string().uuid().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Post = z.infer<typeof Post>;
export type CreatePost = z.infer<typeof CreatePost>;
export type UpdatePost = z.infer<typeof UpdatePost>;
export type PostFilters = z.infer<typeof PostFilters>;
```

Re-export from `src/schemas/index.ts`:

```ts
export * from "./post";
```

### 4. Write CRUD service functions

```ts
// src/services/posts.ts
import { Db } from "./db";
import { Post, CreatePost, UpdatePost, PostFilters } from "../schemas/post";

export async function createPost(db: Db, input: CreatePost): Promise<Post> {
  const { rows } = await db.query<Post>(
    `INSERT INTO posts (title, content, author_id, status, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, content,
       author_id AS "authorId", status, metadata,
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [input.title, input.content, input.authorId, input.status, JSON.stringify(input.metadata)]
  );
  return rows[0];
}

export async function getPost(db: Db, id: string): Promise<Post | null> {
  const { rows } = await db.query<Post>(
    `SELECT id, title, content,
       author_id AS "authorId", status, metadata,
       created_at AS "createdAt", updated_at AS "updatedAt"
     FROM posts WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function listPosts(db: Db, filters: PostFilters): Promise<Post[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.authorId) {
    params.push(filters.authorId);
    conditions.push(`author_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(filters.limit, filters.offset);

  const { rows } = await db.query<Post>(
    `SELECT id, title, content,
       author_id AS "authorId", status, metadata,
       created_at AS "createdAt", updated_at AS "updatedAt"
     FROM posts ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

export async function updatePost(db: Db, id: string, input: UpdatePost): Promise<Post | null> {
  const fields = Object.entries(input)
    .filter(([, v]) => v !== undefined)
    .map(([k, _], i) => {
      // camelCase → snake_case for column names
      const col = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      return `${col} = $${i + 2}`;
    });

  if (fields.length === 0) return getPost(db, id);

  const values = Object.values(input).filter((v) => v !== undefined);
  const { rows } = await db.query<Post>(
    `UPDATE posts SET ${fields.join(", ")}
     WHERE id = $1
     RETURNING id, title, content,
       author_id AS "authorId", status, metadata,
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [id, ...values]
  );
  return rows[0] ?? null;
}

export async function deletePost(db: Db, id: string): Promise<boolean> {
  const { rowCount } = await db.query("DELETE FROM posts WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}
```

### 5. Write seed data (optional but recommended)

```ts
// src/seeds/posts.ts  (or a seed SQL file)
import { Db } from "../services/db";
import { createPost } from "../services/posts";

export async function seedPosts(db: Db) {
  const AUTHOR_ID = "00000000-0000-0000-0000-000000000001"; // must exist in users table

  await createPost(db, {
    title: "Getting Started",
    content: "This is the first post.",
    authorId: AUTHOR_ID,
    status: "published",
  });

  await createPost(db, {
    title: "Draft Post",
    content: "Work in progress.",
    authorId: AUTHOR_ID,
    status: "draft",
  });
}
```

### 6. Apply the migration

```bash
# If using the workbench's runMigrations():
make up          # services must be running
# migrations run automatically on startup

# If running manually:
psql $DATABASE_URL -f supabase/migrations/007_posts.sql

# Verify
psql $DATABASE_URL -c "\d posts"
```

### 7. Write schema tests

```ts
// src/__tests__/schemas/post.test.ts
import { describe, it, expect } from "vitest";
import { Post, CreatePost, UpdatePost } from "../../schemas/post";

describe("CreatePost", () => {
  it("accepts valid input", () => {
    expect(CreatePost.safeParse({
      title: "Hello",
      content: "World",
      authorId: "123e4567-e89b-12d3-a456-426614174000",
    }).success).toBe(true);
  });

  it("rejects title > 200 chars", () => {
    expect(CreatePost.safeParse({
      title: "x".repeat(201),
      content: "ok",
      authorId: "123e4567-e89b-12d3-a456-426614174000",
    }).success).toBe(false);
  });

  it("defaults status to draft", () => {
    const result = CreatePost.parse({
      title: "Hello", content: "World",
      authorId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.status).toBe("draft");
  });
});

describe("UpdatePost", () => {
  it("allows partial updates", () => {
    expect(UpdatePost.safeParse({ title: "New title" }).success).toBe(true);
  });

  it("accepts empty object", () => {
    expect(UpdatePost.safeParse({}).success).toBe(true);
  });
});
```

## Checklist

- [ ] Migration file has zero-padded sequence number (`007_` not `7_`)
- [ ] `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` on every table
- [ ] `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` on every table
- [ ] `updated_at` + trigger for mutable tables
- [ ] `IF NOT EXISTS` on `CREATE TABLE` and `CREATE INDEX` (idempotent migrations)
- [ ] Migration file added to the list in `services/projects.ts` (or migration tool config)
- [ ] Zod schema defined for: full row (`Post`), create input (`CreatePost`), update input (`UpdatePost`)
- [ ] Types exported with `export type X = z.infer<typeof X>`
- [ ] Re-exported from `schemas/index.ts`
- [ ] All SQL column aliases use camelCase (`author_id AS "authorId"`)
- [ ] Service functions take `db: Db` as first parameter
- [ ] Schema tests cover: valid input, boundary violations, optional defaults
- [ ] `npx tsc --noEmit` passes

## Files involved

| File | Action |
|------|--------|
| `supabase/migrations/00N_<name>.sql` | Create migration |
| `src/services/projects.ts` | Add migration filename to MIGRATIONS array |
| `src/schemas/<domain>.ts` | Create schema + types |
| `src/schemas/index.ts` | Add re-export |
| `src/services/<domain>.ts` | Create CRUD service functions |
| `src/__tests__/schemas/<domain>.test.ts` | Create schema tests |
| `src/seeds/<domain>.ts` | Create seed data (optional) |

## Common mistakes

**Renumbering migrations** — once a migration is applied, its filename is its identity. Never rename `007_posts.sql` to `005_posts.sql` to fill a gap. Leave gaps; use the next available number.

**Missing `IF NOT EXISTS`** — migrations must be idempotent. Always use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` so re-running migrations doesn't fail.

**snake_case leaking into API** — always alias in SQL: `author_id AS "authorId"`. If you return raw rows, the API response has `author_id` instead of `authorId`.

**Mutable tables without `updated_at`** — without it, you can't tell when a row was last changed. Add the column and the `BEFORE UPDATE` trigger from the start; retrofitting it requires a migration and backfill.

**Forgetting to register the migration** — the migration file is useless if `runMigrations()` doesn't know about it. Always add it to the MIGRATIONS array immediately after creating the file.

**Unbounded queries** — `SELECT * FROM posts` with no LIMIT on a growing table will eventually cause timeouts. Always add `LIMIT` / `OFFSET` (or cursor-based pagination) to list queries.
