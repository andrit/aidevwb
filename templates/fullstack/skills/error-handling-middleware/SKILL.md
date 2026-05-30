---
name: error-handling-middleware
description: Add centralized error handling — structured error responses, Zod validation errors, HTTP error mapping, and request logging
domain: backend
type: fullstack
triggers:
  - "error handling"
  - "centralized error handler"
  - "structured errors"
  - "error middleware"
  - "consistent error responses"
  - "handle validation errors"
  - "error logging"
  - "error response format"
  - "unhandled errors"
---

# Error Handling Middleware

## When to use

When the API needs consistent, structured error responses instead of Fastify's default format, or when validation errors are leaking internal details. Activate when the user says "add error handling", "I want consistent error responses", "validation errors look wrong", or "unhandled errors are crashing the server".

## Prerequisites

- Fastify + Zod + TypeScript project
- `zod-validation-error` package (converts Zod errors to readable messages)
- A logging strategy (Pino, the built-in Fastify logger, or OTel)

## Steps

### 1. Define the error response schema

Pick ONE shape for all error responses and stick to it. Clients should be able to handle any error the same way.

```ts
// src/schemas/error.ts
import { z } from "zod";

export const ErrorResponse = z.object({
  error: z.string(),           // human-readable message
  code: z.string().optional(), // machine-readable code (e.g. "VALIDATION_ERROR")
  details: z.unknown().optional(), // structured detail for 400 validation errors
  requestId: z.string().optional(), // trace ID for support lookup
});

export type ErrorResponse = z.infer<typeof ErrorResponse>;
```

Re-export from `src/schemas/index.ts`.

### 2. Create the application error class

A typed error class lets services signal specific HTTP status codes without coupling to HTTP.

```ts
// src/lib/errors.ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

// Convenience constructors
export const notFound = (msg = "Not found") => new AppError(msg, 404, "NOT_FOUND");
export const badRequest = (msg: string, details?: unknown) => new AppError(msg, 400, "BAD_REQUEST", details);
export const unauthorized = (msg = "Unauthorized") => new AppError(msg, 401, "UNAUTHORIZED");
export const forbidden = (msg = "Forbidden") => new AppError(msg, 403, "FORBIDDEN");
export const conflict = (msg: string) => new AppError(msg, 409, "CONFLICT");
```

Usage in services:
```ts
import { notFound, conflict } from "../lib/errors";

export async function getPost(db: Db, id: string) {
  const post = await findById(db, id);
  if (!post) throw notFound("Post not found");
  return post;
}
```

### 3. Write the error handler

Register a Fastify `setErrorHandler` that maps all error types to the standard response shape.

```ts
// src/middleware/errorHandler.ts
import { FastifyInstance, FastifyError } from "fastify";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { AppError } from "../lib/errors";

export function registerErrorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    // 1. Zod validation error (thrown by .parse() in route handlers)
    if (error instanceof ZodError) {
      const readable = fromZodError(error);
      fastify.log.warn({ requestId, error: readable.message }, "Validation error");
      return reply.status(400).send({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: error.flatten().fieldErrors,
        requestId,
      });
    }

    // 2. Fastify's own validation error (from JSON Schema in route.schema)
    if ((error as FastifyError).validation) {
      fastify.log.warn({ requestId, validation: (error as FastifyError).validation }, "Schema validation failed");
      return reply.status(400).send({
        error: "Invalid request",
        code: "VALIDATION_ERROR",
        details: (error as FastifyError).validation,
        requestId,
      });
    }

    // 3. Application errors (thrown by services using AppError)
    if (error instanceof AppError) {
      const level = error.statusCode >= 500 ? "error" : "warn";
      fastify.log[level]({ requestId, code: error.code, statusCode: error.statusCode }, error.message);
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details,
        requestId,
      });
    }

    // 4. Errors thrown with a statusCode property (e.g. @fastify/jwt errors)
    if ("statusCode" in error && typeof error.statusCode === "number") {
      fastify.log.warn({ requestId, statusCode: error.statusCode }, error.message);
      return reply.status(error.statusCode).send({
        error: error.message,
        requestId,
      });
    }

    // 5. Unexpected errors — log fully, return generic message
    fastify.log.error({ requestId, err: error }, "Unexpected error");
    return reply.status(500).send({
      error: "An unexpected error occurred",
      code: "INTERNAL_ERROR",
      requestId,
    });
  });
}
```

### 4. Register the error handler

```ts
// src/index.ts (or wherever Fastify is initialized)
import { registerErrorHandler } from "./middleware/errorHandler";

const fastify = Fastify({ logger: true, genReqId: () => crypto.randomUUID() });

registerErrorHandler(fastify);  // register BEFORE routes
await registerRoutes(fastify, db);
```

### 5. Add a not-found handler

```ts
// src/index.ts
fastify.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    error: `Route ${request.method} ${request.url} not found`,
    code: "NOT_FOUND",
    requestId: request.id,
  });
});
```

### 6. Install zod-validation-error

```bash
npm install zod-validation-error
```

This converts Zod's internal error format into a single human-readable string:
- Before: `["Expected string, received number at path title"]`
- After: `"Validation error: title must be a string"`

### 7. Test the error handler

```ts
// src/__tests__/routes/errors.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "../../test/app";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp(); });
afterAll(async () => { await app.close(); });

describe("Error handling", () => {
  it("returns structured 400 for invalid JSON body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/posts",
      payload: { title: "" },   // fails min(1) validation
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.requestId).toBeDefined();
  });

  it("returns 404 for unknown route", async () => {
    const res = await app.inject({ method: "GET", url: "/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("does not leak stack traces in 500 responses", async () => {
    // Route that throws an unexpected error (set up a test-only route)
    const res = await app.inject({ method: "GET", url: "/test/throw" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe("An unexpected error occurred");
    expect(body.stack).toBeUndefined();
  });
});
```

### 8. Async error handling in route handlers

Fastify catches synchronous throws automatically. For async handlers, unhandled promise rejections also propagate to `setErrorHandler` as long as the handler is declared `async`. Make sure route handlers are always `async`:

```ts
// ✅ Correct — async, errors propagate to error handler
fastify.get("/posts/:id", async (request, reply) => {
  const post = await getPost(db, id);   // throws notFound() → error handler catches it
  return post;
});

// ❌ Wrong — non-async, promise rejection is unhandled
fastify.get("/posts/:id", (request, reply) => {
  getPost(db, id).then(post => reply.send(post));  // rejection not caught
});
```

## Error Response Reference

| Scenario | Status | `code` | `details` |
|----------|--------|--------|-----------|
| Zod `.parse()` fails | 400 | `VALIDATION_ERROR` | `fieldErrors` object |
| Fastify schema validation | 400 | `VALIDATION_ERROR` | `validation` array |
| Resource not found | 404 | `NOT_FOUND` | — |
| Unauthorized | 401 | `UNAUTHORIZED` | — |
| Forbidden | 403 | `FORBIDDEN` | — |
| Conflict (duplicate) | 409 | `CONFLICT` | — |
| Unexpected error | 500 | `INTERNAL_ERROR` | — (never leak internals) |

## Checklist

- [ ] `registerErrorHandler` called before route registration
- [ ] `setNotFoundHandler` registered for unknown routes
- [ ] All errors return `{ error, code, requestId }` — no bare strings, no Fastify defaults
- [ ] `ZodError` mapped to 400 with `fieldErrors` details
- [ ] Unexpected errors return generic message — no stack traces, no internal details
- [ ] `AppError` used in services instead of bare `throw new Error()`
- [ ] `requestId` set via `genReqId` in Fastify config
- [ ] Route handlers are `async` (so rejections propagate to error handler)
- [ ] Error handler tests cover: 400 validation, 404 unknown route, 500 unexpected

## Files involved

| File | Action |
|------|--------|
| `src/schemas/error.ts` | ErrorResponse schema |
| `src/schemas/index.ts` | Re-export ErrorResponse |
| `src/lib/errors.ts` | AppError class + convenience constructors |
| `src/middleware/errorHandler.ts` | `registerErrorHandler` function |
| `src/index.ts` | Register error handler + not-found handler before routes |
| `src/__tests__/routes/errors.test.ts` | Error handler integration tests |

## Common mistakes

**Registering the error handler after routes** — Fastify's `setErrorHandler` must be registered before routes (or at least before any route that could throw). Register it immediately after creating the Fastify instance.

**Leaking stack traces in 500 responses** — never include `error.stack` or internal error details in the response. Log them server-side, return a generic message to the client.

**Different error shapes across routes** — if one route returns `{ message: "..." }` and another returns `{ error: "..." }`, clients have to handle both. The centralized error handler fixes this — but only if services throw errors rather than sending their own error replies.

**Services calling `reply.send()`** — services should throw errors, not send HTTP responses. Only the route handler (and the error handler) should call `reply.send()`.

**Not handling `ZodError` separately** — Zod's raw error format is verbose and internal. Always convert it with `zod-validation-error` before sending to the client.

**Missing `genReqId`** — without a request ID generator, `requestId` is undefined in error responses, making them impossible to correlate with server logs.
