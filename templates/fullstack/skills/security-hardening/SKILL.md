---
name: security-hardening
description: Harden a Fastify API for production — CORS policy, security headers with Helmet, rate limiting, HTTPS enforcement, and input sanitization at API boundaries
domain: fullstack
type: fullstack
triggers:
  - "security hardening"
  - "CORS"
  - "rate limiting"
  - "security headers"
  - "Helmet"
  - "HTTPS"
  - "API security"
  - "input sanitization"
  - "production security"
  - "OWASP"
---

# Security Hardening

## When to use

Before any public-facing API goes to production. An API without CORS policy, security headers, and rate limiting is open to cross-origin abuse, clickjacking, and credential-stuffing. Activate when deploying to a shared environment, when the API will be accessible from a browser, or any time you hear "it's public-facing."

## Prerequisites

- Fastify application with routes registered
- Domain name(s) for the production deployment (needed for CORS allowlist)
- `production-config-and-secrets` completed (rate limit config should come from env)

## Step 1 — Install Security Plugins

```bash
npm install @fastify/helmet @fastify/cors @fastify/rate-limit
```

## Step 2 — Security Headers with Helmet

Helmet sets HTTP response headers that instruct browsers to enforce security policies.

```typescript
// src/index.ts
import helmet from "@fastify/helmet";

await app.register(helmet, {
  // Content Security Policy — restrict what resources the browser loads
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],         // no inline scripts, no external scripts
      styleSrc:    ["'self'", "'unsafe-inline'"],  // allow inline styles (common need)
      imgSrc:      ["'self'", "data:", "https:"],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'"],
      objectSrc:   ["'none'"],
      frameSrc:    ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  // X-Frame-Options: prevent clickjacking (embedding this page in an iframe)
  frameguard: { action: "deny" },

  // Strict-Transport-Security: browser always uses HTTPS for this domain
  hsts: {
    maxAge: 31536000,  // 1 year
    includeSubDomains: true,
    preload: true,
  },

  // X-Content-Type-Options: browser doesn't MIME-sniff responses
  noSniff: true,

  // Referrer-Policy: don't leak the URL when navigating to external sites
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },

  // Permissions-Policy: disable browser features you don't use
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: [],
  },
});
```

## Step 3 — CORS Policy

CORS restricts which origins (domains) can make requests to your API from a browser.

```typescript
// src/index.ts
import cors from "@fastify/cors";

const ALLOWED_ORIGINS = [
  config.appUrl,  // e.g., "https://myapp.com"
  // Add staging/preview URLs as needed
  ...(config.nodeEnv !== "production" ? ["http://localhost:5173", "http://localhost:3000"] : []),
];

await app.register(cors, {
  origin: (origin, callback) => {
    // Allow requests with no Origin header (curl, server-to-server)
    if (!origin) return callback(null, true);

    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS policy`), false);
    }
  },
  methods:     ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
  exposedHeaders: ["X-Request-ID"],
  credentials: true,    // allow cookies / Authorization header
  maxAge:      86400,   // preflight cache: 24 hours
});
```

## Step 4 — Rate Limiting

Rate limiting prevents credential stuffing, brute force, and runaway clients.

```typescript
// src/index.ts
import rateLimit from "@fastify/rate-limit";
import Redis from "ioredis";

// Use Redis for distributed rate limiting (works across multiple instances)
// Falls back to in-memory if Redis is unavailable
const redis = config.redisUrl ? new Redis(config.redisUrl) : null;

await app.register(rateLimit, {
  global: true,              // apply to all routes by default
  max:    100,               // 100 requests...
  timeWindow: "1 minute",   // ...per minute per IP

  // Use Redis for distributed tracking across multiple instances
  redis: redis ?? undefined,

  // Identify clients by IP (or by user ID for authenticated routes)
  keyGenerator: (req) => req.ip,

  // Return structured error (not just status code)
  errorResponseBuilder: (req, context) => ({
    error:      "Too Many Requests",
    message:    `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    retryAfter: Math.ceil(context.ttl / 1000),
  }),
});

// Tighter limit on auth endpoints — brute force target
app.post("/auth/login", {
  config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
}, loginHandler);

// No limit on health endpoints — orchestrators poll these constantly
app.get("/health/live",  { config: { rateLimit: false } }, liveHandler);
app.get("/health/ready", { config: { rateLimit: false } }, readyHandler);
```

## Step 5 — HTTPS Enforcement

```typescript
// Redirect HTTP to HTTPS at the application level
// (Preferred: handle at the load balancer/reverse proxy level instead)
app.addHook("onRequest", async (req, reply) => {
  // x-forwarded-proto is set by load balancers (AWS ALB, nginx, Cloudflare)
  const proto = req.headers["x-forwarded-proto"];
  if (
    config.nodeEnv === "production" &&
    proto &&
    proto !== "https"
  ) {
    return reply.redirect(`https://${req.hostname}${req.url}`, 301);
  }
});
```

```nginx
# Better: redirect at nginx level (before requests hit the app)
server {
    listen 80;
    return 301 https://$host$request_uri;
}
```

## Step 6 — Input Sanitization

Zod validation (already in every route) is the primary defense. Add these additional guards:

```typescript
// src/middleware/sanitize.ts

// Limit request body size — prevents OOM via large payload attacks
// Already configurable in Fastify:
const app = Fastify({ bodyLimit: 1_048_576 }); // 1MB max body

// Reject requests with unexpected Content-Type for mutation routes
app.addHook("preValidation", async (req, reply) => {
  const mutationMethods = ["POST", "PUT", "PATCH"];
  if (
    mutationMethods.includes(req.method) &&
    req.headers["content-type"] &&
    !req.headers["content-type"].includes("application/json")
  ) {
    return reply.code(415).send({ error: "Unsupported Media Type" });
  }
});

// Never pass user input directly to SQL — use parameterized queries
// ✗ Wrong (SQL injection):
// db.query(`SELECT * FROM users WHERE email = '${email}'`)

// ✓ Right (parameterized):
// db.one("SELECT * FROM users WHERE email = $1", [email])
```

## Step 7 — Security Headers Audit

After applying these changes, verify with a tool:

```bash
# Install securityheaders.com equivalent locally
npm install -g observatory-cli

# Check your staging deployment
observatory --format=report https://staging.myapp.com

# Or use curl to inspect headers:
curl -I https://staging.myapp.com/health/live
# Look for: Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options,
#            Content-Security-Policy, Referrer-Policy

# Check CORS:
curl -H "Origin: https://evil.com" -I https://staging.myapp.com/api/users
# Should NOT include Access-Control-Allow-Origin: https://evil.com
```

## Checklist

- [ ] `@fastify/helmet` registered — check headers with `curl -I`
- [ ] CORS `origin` is an allowlist of specific domains, not `*`
- [ ] CORS `credentials: true` if cookies or Authorization header used
- [ ] Rate limiting applied globally; tighter limit on `/auth/*` endpoints
- [ ] Health endpoints exempt from rate limiting (`rateLimit: false`)
- [ ] Redis-backed rate limiting configured (required for multi-instance deployments)
- [ ] HTTPS redirect active in production (at load balancer or app level)
- [ ] `bodyLimit` set (default 1MB is usually fine)
- [ ] Parameterized queries used everywhere — no string concatenation in SQL
- [ ] Security headers verified on staging with curl or observatory

## Files involved

| File | Action |
|------|--------|
| `src/index.ts` | Update: register `helmet`, `cors`, `rate-limit`; add HTTPS hook; set `bodyLimit` |
| `src/config.ts` | Update: add `appUrl`, `redisUrl`, `rateLimitMax`, `rateLimitWindow` |
| `nginx.conf` (if used) | Update: HTTP→HTTPS redirect at proxy level |

## Common mistakes

**`cors({ origin: "*" })`** — allows any website to make authenticated requests to your API from a user's browser. This is almost never correct for a production API with credentials. Use an explicit allowlist.

**Rate limiting by IP only for authenticated routes** — authenticated users behind a corporate NAT share one IP. A per-IP limit of 100 req/min affects 50 engineers sharing a NAT equally. For authenticated routes, identify clients by `req.user.id` (or similar), not IP.

**CSP that breaks your own app** — the Content Security Policy in Step 2 is strict. If your frontend uses inline scripts, Google Analytics, Stripe.js, or CDN-hosted fonts, you'll need to add those to the appropriate CSP directive. Start by checking the browser console for CSP violations in staging before deploying to production.
