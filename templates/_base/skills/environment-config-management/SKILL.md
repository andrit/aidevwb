---
name: environment-config-management
description: Managing configuration and secrets across dev, staging, and production environments without leaking secrets into git
metadata:
  type: skill
  domain: deployment
  triggers:
    - "manage config across environments"
    - "environment variables"
    - "secrets management"
    - "keep staging and prod in sync"
    - "env file"
    - "configuration drift"
    - "new config key"
  capability_contracts:
    - provides: []
    - consumes: []
---

# Skill: Environment Config Management

## When to use

When you need to:
- Add a new config key that affects multiple environments
- Rotate secrets after a breach or as routine hygiene
- Onboard a team member who needs environment access
- Audit what configuration differs between environments
- Prevent config drift (staging config drifting away from what production actually needs)

## Prerequisites

- You have a deployed project with at least two environments (dev + staging, or staging + prod)
- You understand which values are secrets (API keys, passwords) vs non-secrets (port numbers, model names)

## The Pattern

```
COMMITTED to git:        .env.example      ← all keys, no values, comments explaining each
NOT committed to git:    .env              ← dev (workbench) values
                         .env.staging      ← staging values
                         .env.production   ← production values (on prod host only)
```

`.env.example` is the single source of truth for what config keys exist. Every key that any environment needs must appear here.

## Steps

### 1. Establish `.env.example` as the canonical key list

Your `.env.example` should have every key, grouped by concern, with a comment explaining each:

```bash
# .env.example — committed to git, no real values

# ── Required ──────────────────────────────────────────────
POSTGRES_PASSWORD=           # Database password — use a strong random value per environment
ANTHROPIC_API_KEY=           # From console.anthropic.com — use different keys per environment

# ── Embedding (RAG projects) ──────────────────────────────
EMBEDDING_BASE_URL=http://ollama:11434/v1   # or https://api.voyageai.com/v1
EMBEDDING_API_KEY=ollama                    # or your cloud provider API key
EMBEDDING_MODEL=mxbai-embed-large          # must match the model used when docs were indexed
EMBEDDING_DIMENSIONS=1024                  # must match the model's output dimensions

# ── Model ─────────────────────────────────────────────────
CLAUDE_MODEL=claude-sonnet-4-6             # staging can use claude-haiku-4-5-20251001 for cost

# ── Infrastructure (optional — defaults shown) ────────────
# API_PORT=3100
# PG_PORT=5432
# REDIS_PORT=6379
```

### 2. Add all `.env.*` files to `.gitignore`

```bash
# .gitignore — add these if not already present
.env
.env.*
!.env.example
```

The `!.env.example` exception ensures the example stays committed even though all other `.env.*` files are excluded.

### 3. Adding a new config key

When you add a new config key to the application:

1. **Add it to `config.ts`** (or equivalent) with a safe default:
   ```typescript
   // src/config.ts
   export const config = {
     newFeatureFlag: env("NEW_FEATURE_FLAG", "false"),
   };
   ```

2. **Add it to `.env.example`** with a comment:
   ```bash
   NEW_FEATURE_FLAG=false    # Enable experimental feature X (true/false)
   ```

3. **Add it to each environment's `.env` file** — check each host/environment:
   ```bash
   # Dev .env (workbench):
   NEW_FEATURE_FLAG=true      # enabled for development

   # Staging .env:
   NEW_FEATURE_FLAG=true      # enabled for staging testing

   # Production .env:
   NEW_FEATURE_FLAG=false     # disabled until validated
   ```

4. **Audit for drift** — verify no environment is missing the new key:
   ```bash
   # On each host, check the key is set:
   grep NEW_FEATURE_FLAG .env.staging
   ```

### 4. Auditing config drift

Compare what keys are defined vs what `.env.example` says should exist:

```bash
# List all keys in .env.example
grep -E '^[A-Z_]+=' .env.example | cut -d= -f1 | sort > /tmp/expected-keys.txt

# List all keys in a target env file
grep -E '^[A-Z_]+=' .env.staging | cut -d= -f1 | sort > /tmp/staging-keys.txt

# Show keys in example but missing from staging
comm -23 /tmp/expected-keys.txt /tmp/staging-keys.txt
```

Run this before every production deploy as part of the pre-flight.

### 5. Rotating secrets

When rotating a secret (breach, scheduled rotation, key compromise):

1. Generate a new value: `openssl rand -base64 32`
2. Update the secret in the production environment first (so there's no gap in service)
3. If it's a database password: change in Postgres first, then update `.env`
   ```bash
   docker exec -it myapp-db psql -U postgres -c "ALTER USER postgres PASSWORD 'new-password';"
   # then update .env on production host
   ```
4. Restart the affected service: `docker compose restart api worker`
5. Verify it still works: `curl http://localhost:3100/health`
6. Update staging separately with a DIFFERENT new value
7. Update `.env.example` comment if the rotation cadence changed

### 6. Onboarding a team member

Never send secret values over Slack, email, or any unencrypted channel. Options:

**Option A — 1Password / Bitwarden (recommended for teams)**
- Store each environment's secrets in a shared vault
- Share vault access, not individual secrets
- Allows rotation without re-sharing

**Option B — Direct host access**
- Give team member SSH access to each host
- They read `.env` directly on the host
- Appropriate for small teams with infrastructure access already

**Option C — `pass` (GPG-based, for CLI teams)**
```bash
# Initial setup:
pass init <gpg-key-id>
pass insert myapp/staging/POSTGRES_PASSWORD

# Share with team member:
pass git push
# Team member: pass git pull
```

### 7. The `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` constraint

These two values are special: they're baked into the vector index at ingestion time. **Changing them requires a full reindex** (`make reindex` or `POST /reindex`). Every environment must use consistent values unless you intentionally want different knowledgebase configurations per environment.

Before rotating the embedding provider:
```bash
# 1. Update .env with new model + dimensions
# 2. Run reindex to rebuild the vector index
curl -X POST http://localhost:3100/reindex -H "Content-Type: application/json" -d '{"confirm": true}'
# 3. Verify with /status — chunk count should be unchanged, model updated
curl http://localhost:3100/status
```

## Templates

### Complete `.env.example` for a RAG project

```bash
# .env.example
# Copy to .env (dev), .env.staging, .env.production
# Fill in values. NEVER commit files with real values.
# Run: grep -v '^#\|^$' .env.example to see required keys

# ── Required ──────────────────────────────────────────────
POSTGRES_PASSWORD=           # min 20 chars, unique per environment
ANTHROPIC_API_KEY=           # console.anthropic.com → API Keys

# ── Embedding ─────────────────────────────────────────────
# Local Ollama (default, no cost):
EMBEDDING_BASE_URL=http://ollama:11434/v1
EMBEDDING_API_KEY=ollama
EMBEDDING_MODEL=mxbai-embed-large
EMBEDDING_DIMENSIONS=1024

# Voyage AI alternative:
# EMBEDDING_BASE_URL=https://api.voyageai.com/v1
# EMBEDDING_API_KEY=va-...
# EMBEDDING_MODEL=voyage-3
# EMBEDDING_DIMENSIONS=1024

# ── Claude Model ──────────────────────────────────────────
# Production: claude-sonnet-4-6
# Staging/dev: claude-haiku-4-5-20251001 (10x cheaper, use for testing)
CLAUDE_MODEL=claude-sonnet-4-6

# ── Optional: override default ports ─────────────────────
# (only needed if running multiple stacks on one host)
# API_PORT=3100
# PG_PORT=5432
# REDIS_PORT=6379
```

### Drift audit script

Save as `scripts/audit-env-drift.sh`:

```bash
#!/usr/bin/env bash
# Audit config drift: compare .env.example keys against a target env file
# Usage: bash scripts/audit-env-drift.sh .env.staging

TARGET="${1:-.env}"

if [ ! -f ".env.example" ]; then
  echo "✗ .env.example not found — run from project root"
  exit 1
fi

if [ ! -f "$TARGET" ]; then
  echo "✗ $TARGET not found"
  exit 1
fi

EXPECTED=$(grep -E '^[A-Z_]+=' .env.example | cut -d= -f1 | sort)
ACTUAL=$(grep -E '^[A-Z_]+=' "$TARGET" | cut -d= -f1 | sort)

MISSING=$(comm -23 <(echo "$EXPECTED") <(echo "$ACTUAL"))
EXTRA=$(comm -13 <(echo "$EXPECTED") <(echo "$ACTUAL"))

if [ -z "$MISSING" ] && [ -z "$EXTRA" ]; then
  echo "✓ $TARGET is in sync with .env.example"
else
  [ -n "$MISSING" ] && echo "✗ Keys in .env.example but missing from $TARGET:" && echo "$MISSING" | sed 's/^/  /'
  [ -n "$EXTRA" ]   && echo "⚠ Keys in $TARGET not in .env.example (consider documenting them):" && echo "$EXTRA" | sed 's/^/  /'
  exit 1
fi
```

## Checklist

- [ ] `.env.example` committed with every key documented
- [ ] `.gitignore` excludes `.env`, `.env.*` but not `.env.example`
- [ ] Every environment has all keys from `.env.example`
- [ ] No environment shares secrets with another environment (different passwords per env)
- [ ] `EMBEDDING_MODEL` + `EMBEDDING_DIMENSIONS` are consistent across environments (or intentionally different with separate reindex)
- [ ] Secrets are NOT stored in: git, Slack messages, emails, Notion, or other plaintext systems
- [ ] New config keys added to `.env.example` before merging to main

## Files involved

| File | Action |
|------|--------|
| `.env.example` | Update whenever a new config key is added |
| `.gitignore` | Ensure `.env.*` is excluded except `.env.example` |
| `.env` | Dev values — not committed |
| `.env.staging` | Staging values — not committed, lives on staging host |
| `.env.production` | Production values — not committed, lives on prod host only |
| `scripts/audit-env-drift.sh` | Optional: add drift audit to CI or pre-deploy checklist |

## Common mistakes

- **Using the same API key across environments**: If staging gets compromised or runs wild (hitting rate limits), it affects production. Always use separate keys with separate spending limits.
- **Documenting secrets in `.env.example` values**: `POSTGRES_PASSWORD=changeme` in `.env.example` creates false security — people forget to change it. Use empty values and clear comments instead.
- **Config drift going undetected for months**: A key added to dev `.env` but never added to `.env.example` becomes invisible. The next person to set up staging won't know it exists. Enforce: .env.example first, then environment files.
- **`EMBEDDING_MODEL` mismatch between environments**: If staging uses `voyage-3` (1024 dims) and prod uses `mxbai-embed-large` (1024 dims), queries will work numerically but recall quality differs. Document intended model per environment in `.env.example` comments.
- **Storing production `.env` in the repo "just temporarily"**: It never stays temporary. Production secrets in git, even in a private repo, are a security incident waiting to happen.
