---
name: production-config-and-secrets
description: Replace .env files with 12-factor app configuration — validate all config on startup, inject secrets from a manager (AWS SSM, Doppler, Vault), and never ship credentials in environment files
domain: fullstack
type: fullstack
triggers:
  - "production config"
  - "secrets management"
  - "environment variables"
  - "12-factor"
  - "AWS SSM"
  - "Doppler"
  - "Vault"
  - "production .env"
  - "config per environment"
  - "secret rotation"
---

# Production Config and Secrets

## When to use

Before deploying any service to a shared or production environment. `.env` files work in development but are a security risk and operational liability in production: they sit on disk, don't rotate, and aren't auditable. This skill replaces them with proper config validation + secrets manager integration. Activate when the user says "we're deploying to production", "how do I manage secrets?", or "I have credentials in my .env file."

## Prerequisites

- Service with a working `src/config.ts` (or equivalent) that reads from `process.env`
- A secrets manager account: AWS SSM Parameter Store (free tier), Doppler (free tier for small teams), HashiCorp Vault, or GCP Secret Manager

## The 12-Factor Rules for Config

1. **Strict separation of config from code** — anything that varies between environments (dev/staging/prod) is config. Anything that doesn't vary is code.
2. **Config in environment variables** — not in files checked into the repo, not in constants.
3. **No grouping by environment in code** — no `if (NODE_ENV === 'production')` branches that change behavior. Config values carry the behavior differences.
4. **Fail fast on missing config** — validate all required env vars on startup and crash with a clear error before accepting any requests.

## Step 1 — Validate All Config on Startup

```typescript
// src/config.ts — validate everything on startup, export a frozen config object
import { z } from "zod";

const ConfigSchema = z.object({
  // Server
  port:     z.coerce.number().int().min(1).max(65535).default(3000),
  nodeEnv:  z.enum(["development", "staging", "production"]).default("development"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Database
  databaseUrl: z.string().url(),
  dbPoolMin:   z.coerce.number().default(2),
  dbPoolMax:   z.coerce.number().default(10),

  // Auth
  jwtSecret:    z.string().min(32),  // enforce minimum key length
  jwtExpiryMs:  z.coerce.number().default(24 * 60 * 60 * 1000),

  // External APIs
  anthropicApiKey: z.string().startsWith("sk-ant-").optional(),
  openrouterApiKey: z.string().optional(),
});

function loadConfig() {
  const result = ConfigSchema.safeParse({
    port:            process.env.PORT,
    nodeEnv:         process.env.NODE_ENV,
    logLevel:        process.env.LOG_LEVEL,
    databaseUrl:     process.env.DATABASE_URL,
    dbPoolMin:       process.env.DB_POOL_MIN,
    dbPoolMax:       process.env.DB_POOL_MAX,
    jwtSecret:       process.env.JWT_SECRET,
    jwtExpiryMs:     process.env.JWT_EXPIRY_MS,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
  });

  if (!result.success) {
    // Print every missing/invalid field — don't make the operator guess
    console.error("Configuration validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return Object.freeze(result.data);
}

export const config = loadConfig();
export type Config = typeof config;
```

## Step 2 — Separate Development and Production Config Paths

Development uses `.env` (local, gitignored). Production injects values from a secrets manager.

```
.env                  ← development only; in .gitignore; never in production
.env.example          ← checked in; shows every variable name with a fake/example value
.env.test             ← for test runs; may be checked in if it contains only test values
```

```bash
# .env.example — what to show in the repo (no real values)
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/myapp_dev
DB_POOL_MIN=2
DB_POOL_MAX=10
JWT_SECRET=at-least-32-chars-change-this-in-prod
JWT_EXPIRY_MS=86400000
ANTHROPIC_API_KEY=sk-ant-...
```

## Step 3 — Integrate with a Secrets Manager

### Option A: AWS SSM Parameter Store (recommended for AWS deployments)

```typescript
// src/lib/secrets.ts — fetch secrets at startup (not per-request)
import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";

const APP = process.env.APP_NAME ?? "myapp";
const ENV = process.env.NODE_ENV ?? "production";

export async function loadSecretsFromSSM(): Promise<Record<string, string>> {
  const client = new SSMClient({ region: process.env.AWS_REGION ?? "us-east-1" });

  const { Parameters } = await client.send(new GetParametersCommand({
    Names: [
      `/${APP}/${ENV}/database-url`,
      `/${APP}/${ENV}/jwt-secret`,
      `/${APP}/${ENV}/anthropic-api-key`,
    ],
    WithDecryption: true,  // SecureString parameters
  }));

  return Object.fromEntries(
    (Parameters ?? []).map((p) => [
      p.Name!.split("/").pop()!,  // e.g., "database-url"
      p.Value!
    ])
  );
}

// src/index.ts — load secrets before building config
import { loadSecretsFromSSM } from "./lib/secrets";

async function main() {
  if (process.env.NODE_ENV !== "development") {
    const secrets = await loadSecretsFromSSM();
    // Inject into process.env so config.ts picks them up
    process.env.DATABASE_URL     = secrets["database-url"];
    process.env.JWT_SECRET       = secrets["jwt-secret"];
    process.env.ANTHROPIC_API_KEY = secrets["anthropic-api-key"];
  }

  // config is loaded after secrets are injected
  const { config } = await import("./config");
  // ... build and start the server
}
```

### Option B: Doppler (simpler, no AWS required)

```bash
# Install Doppler CLI
brew install dopplerhq/cli/doppler

# Inject secrets at runtime — Doppler replaces .env entirely in production
doppler run -- node dist/index.js
```

```yaml
# docker-compose.yml (production)
services:
  api:
    image: myapp:latest
    command: ["doppler", "run", "--", "node", "dist/index.js"]
    environment:
      DOPPLER_TOKEN: ${DOPPLER_TOKEN}  # the only secret that needs to be pre-set
```

### Option C: Docker secrets (for self-hosted Swarm/Compose)

```yaml
# docker-compose.yml
services:
  api:
    secrets:
      - db_password
      - jwt_secret
    environment:
      DB_PASSWORD_FILE: /run/secrets/db_password
      JWT_SECRET_FILE:  /run/secrets/jwt_secret

secrets:
  db_password:
    external: true
  jwt_secret:
    external: true
```

```typescript
// src/lib/docker-secrets.ts
import { readFileSync } from "fs";

export function readSecret(envVar: string): string {
  const fileVar = `${envVar}_FILE`;
  if (process.env[fileVar]) {
    return readFileSync(process.env[fileVar]!, "utf-8").trim();
  }
  return process.env[envVar] ?? "";
}
// Usage: process.env.JWT_SECRET = readSecret("JWT_SECRET");
```

## Step 4 — Per-Environment Config Pattern

```
environments/
├── development.env   ← loaded locally via dotenv (gitignored)
├── staging/          ← values in SSM under /<app>/staging/
└── production/       ← values in SSM under /<app>/production/
```

Every environment has identical variable names. Only values differ. The code never branches on `NODE_ENV` to change behavior — it reads the value and uses it.

```typescript
// ✗ Wrong: NODE_ENV branch changes behavior
const timeout = process.env.NODE_ENV === 'production' ? 5000 : 30000;

// ✓ Right: config value carries the environment's decision
const timeout = config.requestTimeoutMs; // = 5000 in prod SSM, 30000 in dev .env
```

## Step 5 — Rotation Without Restart

For secrets that rotate (DB passwords, API keys), support config reload without a full restart:

```typescript
// src/lib/secrets-refresh.ts
// Re-fetch secrets from SSM and rebuild the DB connection pool
export async function refreshSecrets(db: Db): Promise<void> {
  const secrets = await loadSecretsFromSSM();
  const newDatabaseUrl = secrets["database-url"];

  if (newDatabaseUrl !== config.databaseUrl) {
    await db.end();           // drain existing connections
    await db.connect(newDatabaseUrl); // reconnect with new password
    console.log("Database credentials rotated successfully");
  }
}

// Trigger rotation via a health endpoint (protected by internal auth):
app.post("/internal/rotate-secrets", { onRequest: [requireInternalToken] }, async () => {
  await refreshSecrets(db);
  return { rotated: true };
});
```

## Checklist

- [ ] `ConfigSchema` validates every required variable; process exits with clear message on failure
- [ ] `.env` is in `.gitignore`; `.env.example` is committed with fake values
- [ ] No real credentials anywhere in the repository (including git history — check with `git log -S "sk-ant"`)
- [ ] Production deployment uses a secrets manager (SSM, Doppler, Vault, or Docker secrets)
- [ ] No `if (NODE_ENV === 'production')` branches — config values carry behavioral differences
- [ ] Secret values are never logged — Pino's `redact` covers `*.password`, `*.secret`, `*.token`
- [ ] Rotation tested: secret updated in manager → service picks up without full restart

## Files involved

| File | Action |
|------|--------|
| `src/config.ts` | Update: full Zod schema validation, fail-fast on startup |
| `src/lib/secrets.ts` | Create: SSM/Doppler/Vault fetch function |
| `src/index.ts` | Update: load secrets before importing config |
| `.env.example` | Create/update: all variable names with fake values |
| `.gitignore` | Verify: `.env` and `*.env.local` are excluded |

## Common mistakes

**Logging config values on startup** — "Config loaded: { jwtSecret: 'abc123...' }" logs secrets to your log aggregator. Log the variable names and whether they're set, never the values. Use Pino's `redact` to sanitize logs automatically.

**`NODE_ENV` as a behavior switch** — `if (NODE_ENV === 'production') { useRealPaymentProvider() }` means staging and development always use fakes, even if you want to test with the real provider. Use a dedicated `PAYMENT_PROVIDER=stripe|sandbox` env var instead.

**Fetching secrets per-request** — SSM and Vault have rate limits and add latency. Fetch secrets once at startup, cache in memory, refresh on rotation signal. Never call the secrets API on the hot path.
