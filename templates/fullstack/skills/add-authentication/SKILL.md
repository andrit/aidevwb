---
name: add-authentication
description: Add JWT or session-based authentication — middleware, protected routes, login/logout endpoints, and token refresh
domain: backend
type: fullstack
triggers:
  - "add authentication"
  - "add auth"
  - "protect a route"
  - "add login"
  - "add JWT"
  - "add sessions"
  - "require login"
  - "auth middleware"
  - "who is the current user"
---

# Add Authentication

## When to use

When adding user authentication to a fullstack application. Covers JWT (stateless, good for APIs and SPAs) and session-based auth (stateful, good for server-rendered apps). Activate when the user says "add auth", "protect this route", "add a login endpoint", or "I need to know who the current user is".

## Prerequisites

- Existing Fastify + TypeScript project
- Users table in the database (or create one first — see `add-database-table` skill)
- `bcrypt` or `argon2` for password hashing
- Decision: JWT vs sessions (use the flowchart below)

## JWT vs Sessions — Choose First

```
Is your frontend a SPA (React, Vue) or mobile app?
├── YES → JWT (stateless, no server-side session store needed)
└── NO  → Is the app server-rendered (Next.js pages, traditional MPA)?
          ├── YES → Sessions (simpler, server-managed, naturally CSRF-safe)
          └── NO  → JWT (default for REST APIs consumed by multiple clients)

Does the app need instant token revocation (security incident, logout-all-devices)?
└── YES → Sessions (or JWT + Redis denylist — adds complexity)
```

---

## Option A: JWT Authentication

### 1. Install dependencies

```bash
npm install @fastify/jwt @fastify/cookie bcryptjs
npm install --save-dev @types/bcryptjs
```

### 2. Register the JWT plugin

```ts
// src/plugins/auth.ts
import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import { FastifyInstance } from "fastify";

export default fp(async function authPlugin(fastify: FastifyInstance) {
  await fastify.register(cookie);
  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET!,   // must be in .env, min 32 chars
    sign: { expiresIn: "15m" },        // access token: short-lived
    cookie: { cookieName: "access_token", signed: false },
  });
});
```

Register in `src/index.ts`:
```ts
import authPlugin from "./plugins/auth";
await fastify.register(authPlugin);
```

### 3. Create the users migration

```sql
-- supabase/migrations/008_users.sql
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4. Define schemas

```ts
// src/schemas/auth.ts
import { z } from "zod";

export const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

export const TokenResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
});

export const UserPayload = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["user", "admin"]),
});

export type LoginBody = z.infer<typeof LoginBody>;
export type RegisterBody = z.infer<typeof RegisterBody>;
export type TokenResponse = z.infer<typeof TokenResponse>;
export type UserPayload = z.infer<typeof UserPayload>;
```

### 5. Write the auth service

```ts
// src/services/auth.ts
import bcrypt from "bcryptjs";
import { Db } from "./db";
import { RegisterBody, LoginBody, UserPayload } from "../schemas/auth";

export async function registerUser(db: Db, input: RegisterBody): Promise<UserPayload> {
  const existing = await db.query("SELECT id FROM users WHERE email = $1", [input.email]);
  if (existing.rowCount) throw Object.assign(new Error("Email already registered"), { statusCode: 409 });

  const hash = await bcrypt.hash(input.password, 12);
  const { rows } = await db.query<UserPayload>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     RETURNING id, email, role`,
    [input.email, hash]
  );
  return rows[0];
}

export async function loginUser(db: Db, input: LoginBody): Promise<UserPayload> {
  const { rows } = await db.query<{ id: string; email: string; role: string; passwordHash: string }>(
    `SELECT id, email, role, password_hash AS "passwordHash" FROM users WHERE email = $1`,
    [input.email]
  );
  const user = rows[0];
  if (!user) throw Object.assign(new Error("Invalid credentials"), { statusCode: 401 });

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) throw Object.assign(new Error("Invalid credentials"), { statusCode: 401 });

  return { id: user.id, email: user.email, role: user.role as "user" | "admin" };
}
```

### 6. Write the auth routes

```ts
// src/routes/auth.ts
import { FastifyInstance } from "fastify";
import { Db } from "../services/db";
import { LoginBody, RegisterBody, TokenResponse } from "../schemas/auth";
import { loginUser, registerUser } from "../services/auth";

export function registerAuthRoutes(fastify: FastifyInstance, db: Db) {
  fastify.post("/auth/register", async (request, reply) => {
    const body = RegisterBody.parse(request.body);
    const user = await registerUser(db, body);
    const accessToken = fastify.jwt.sign({ id: user.id, email: user.email, role: user.role });
    return reply.status(201).send({ accessToken, expiresIn: 900 });
  });

  fastify.post("/auth/login", async (request, reply) => {
    const body = LoginBody.parse(request.body);
    const user = await loginUser(db, body);
    const accessToken = fastify.jwt.sign({ id: user.id, email: user.email, role: user.role });
    // Set HttpOnly cookie for web clients; also return token for API clients
    reply.setCookie("access_token", accessToken, { httpOnly: true, sameSite: "lax", path: "/" });
    return { accessToken, expiresIn: 900 };
  });

  fastify.post("/auth/logout", async (request, reply) => {
    reply.clearCookie("access_token");
    return { ok: true };
  });
}
```

### 7. Add the auth middleware (preHandler hook)

```ts
// src/middleware/requireAuth.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { UserPayload } from "../schemas/auth";

// Extend Fastify's request type to include `user`
declare module "fastify" {
  interface FastifyRequest {
    user: UserPayload;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();   // reads Authorization header OR cookie
  } catch {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (request.user?.role !== "admin") {
    return reply.status(403).send({ error: "Forbidden" });
  }
}
```

### 8. Protect a route

```ts
// In any route file:
fastify.get("/profile", { preHandler: [requireAuth] }, async (request) => {
  return { user: request.user };
});

fastify.delete("/admin/users/:id", { preHandler: [requireAdmin] }, async (request) => {
  // Only admins reach here
});
```

---

## Option B: Session-Based Authentication

### 1. Install dependencies

```bash
npm install @fastify/session @fastify/cookie connect-pg-simple bcryptjs
npm install --save-dev @types/bcryptjs @types/connect-pg-simple
```

### 2. Sessions migration

```sql
-- supabase/migrations/009_sessions.sql
CREATE TABLE IF NOT EXISTS session (
  sid    TEXT        NOT NULL PRIMARY KEY,
  sess   JSONB       NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON session(expire);
```

### 3. Register the session plugin

```ts
// src/plugins/session.ts
import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import pgStore from "connect-pg-simple";
import { FastifyInstance } from "fastify";

const PgStore = pgStore(session as any);

export default fp(async function sessionPlugin(fastify: FastifyInstance) {
  await fastify.register(cookie);
  await fastify.register(session, {
    secret: process.env.SESSION_SECRET!,  // min 32 chars
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === "production", maxAge: 86400000 },
    store: new PgStore({ conString: process.env.DATABASE_URL }),
  });
});

// Extend session type
declare module "@fastify/session" {
  interface SessionData {
    userId: string;
    role: string;
  }
}
```

### 4. Session auth middleware

```ts
// src/middleware/requireAuth.ts (session version)
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.session.userId) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}
```

---

## Checklist

- [ ] `JWT_SECRET` (or `SESSION_SECRET`) in `.env` — minimum 32 characters, never committed
- [ ] Password hashed with `bcrypt` (cost factor 12) — never stored in plaintext
- [ ] "Invalid credentials" error message is identical for wrong email AND wrong password (prevents user enumeration)
- [ ] JWT tokens set as `HttpOnly` cookies for web clients
- [ ] `requireAuth` middleware applied to all protected routes
- [ ] Auth routes registered in `routes/index.ts`
- [ ] Schema tests for `LoginBody` (valid, invalid email, short password)
- [ ] `npx tsc --noEmit` passes with no errors on the request type augmentation

## Files involved

| File | Action |
|------|--------|
| `supabase/migrations/008_users.sql` | Create users table |
| `src/plugins/auth.ts` | JWT / session plugin |
| `src/schemas/auth.ts` | Auth schemas + types |
| `src/services/auth.ts` | register, login, password hashing |
| `src/routes/auth.ts` | POST /auth/register, /login, /logout |
| `src/routes/index.ts` | Register auth routes |
| `src/middleware/requireAuth.ts` | Auth + admin preHandler hooks |
| `.env` | Add JWT_SECRET or SESSION_SECRET |

## Common mistakes

**Storing passwords in plaintext** — always hash with `bcrypt.hash(password, 12)`. Cost factor 10 is the minimum; 12 is recommended.

**Same error for wrong email vs wrong password** — always return "Invalid credentials" for both. Different messages let attackers enumerate valid email addresses.

**JWT secret in source code** — the secret must come from an environment variable. Never hardcode it; never commit `.env` to version control.

**Short-lived tokens without refresh** — 15-minute access tokens are useless if there's no refresh token mechanism. Either implement a refresh token endpoint or use sessions for apps that need persistent login.

**Not setting `httpOnly: true` on cookies** — without `httpOnly`, JavaScript can read the cookie and XSS attacks can steal tokens. Always set `httpOnly: true` for auth cookies.

**Checking `role` in the route handler** — role checks belong in middleware (`requireAdmin`), not scattered in route handlers. Centralizing it means you can't accidentally forget the check on a new endpoint.
