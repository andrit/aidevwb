---
name: setup-staging-environment
description: Stand up a pre-production staging environment from an exported workbench stack
metadata:
  type: skill
  domain: deployment
  triggers:
    - "set up staging"
    - "staging environment"
    - "pre-production"
    - "test before production"
    - "second environment"
  capability_contracts:
    - provides: [rest_api]
    - consumes: []
---

# Skill: Setup Staging Environment

## When to use

When you have a working registered project and need a second environment (staging, QA, preview) to validate changes before production. Use this before any significant release, database migration, or infrastructure change.

## Prerequisites

- Project is registered: `make list-projects` shows it
- `make export-stack NAME=<project>` runs without error
- Target host has Docker + Docker Compose v2 installed
- You know which environment variables differ between dev and staging (DB password, API keys, ports)

## Steps

### 1. Export the stack

```bash
make export-stack NAME=myapp FORMAT=compose
```

This writes a self-contained stack to `.workbench/export/myapp/`. Inspect it:

```bash
ls .workbench/export/myapp/
# docker-compose.yml  Dockerfile.api  Dockerfile.worker  env.example  migrations/
```

### 2. Create a staging env file

Copy the example and fill in staging-specific values. Never commit this file.

```bash
cp .workbench/export/myapp/env.example .workbench/export/myapp/.env.staging
```

Staging-specific overrides (everything else inherits from the image defaults):

```bash
# .env.staging
POSTGRES_PASSWORD=<strong-random-password>
ANTHROPIC_API_KEY=<your-key>
EMBEDDING_MODEL=mxbai-embed-large      # or your chosen model
CLAUDE_MODEL=claude-haiku-4-5-20251001 # cheaper model for staging if cost matters

# Ports — change if staging runs on same host as dev
PG_PORT=5433
REDIS_PORT=6380
API_PORT=3101
```

### 3a. Local staging (same machine as dev)

Run the exported stack with offset ports so it doesn't collide with the workbench:

```bash
cd .workbench/export/myapp
docker compose --env-file .env.staging -p myapp-staging up -d
```

The `-p myapp-staging` project name namespaces containers and volumes separately from the workbench stack.

Verify:
```bash
curl http://localhost:3101/health
```

### 3b. Remote staging (separate host or cloud VM)

Copy the export directory to the staging host:

```bash
rsync -av .workbench/export/myapp/ user@staging-host:/opt/myapp/
scp .workbench/export/myapp/.env.staging user@staging-host:/opt/myapp/.env
```

On the staging host:
```bash
cd /opt/myapp
docker compose up -d
```

### 4. Seed staging data (optional)

If staging needs a copy of production/dev data:

```bash
# Backup from workbench dev database
make backup-project NAME=myapp
# backup written to backups/myapp-<timestamp>.sql.gz

# Copy to staging host and restore
scp backups/myapp-<timestamp>.sql.gz user@staging-host:/opt/myapp/
ssh user@staging-host "cd /opt/myapp && gunzip -c myapp-*.sql.gz | docker exec -i myapp-db psql -U postgres -d myapp"
```

### 5. Smoke test staging

```bash
# Health check
curl http://staging-host:3100/health

# RAG status (if project has RAG capability)
curl http://staging-host:3100/status

# Run project tests against staging
STAGING_URL=http://staging-host:3100 npm test
```

### 6. Document the staging URL

Add to your project's `.workbench/environments.md` (create if it doesn't exist):

```markdown
## Environments

| Environment | URL | Last deployed |
|-------------|-----|--------------|
| Dev (workbench) | http://localhost:3100 | always current |
| Staging | http://staging-host:3100 | <date> |
| Production | https://api.myapp.com | <date> |
```

## Templates

### Minimal staging `.env`

```bash
# Secrets (required, never commit)
POSTGRES_PASSWORD=
ANTHROPIC_API_KEY=

# Embedding (required if using RAG)
EMBEDDING_BASE_URL=http://ollama:11434/v1
EMBEDDING_API_KEY=ollama
EMBEDDING_MODEL=mxbai-embed-large
EMBEDDING_DIMENSIONS=1024

# Model (optional — use cheaper model for staging)
CLAUDE_MODEL=claude-haiku-4-5-20251001

# Ports (only if staging shares a host with dev)
# PG_PORT=5433
# REDIS_PORT=6380
# API_PORT=3101
```

### Docker Compose override for local staging resource limits

```yaml
# docker-compose.override.staging.yml
# Usage: docker compose -f docker-compose.yml -f docker-compose.override.staging.yml up -d
services:
  api:
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 512M
  worker:
    deploy:
      resources:
        limits:
          cpus: "0.25"
          memory: 256M
```

## Checklist

- [ ] `.env.staging` created and NOT committed to git
- [ ] `.env.staging` added to `.gitignore`
- [ ] Stack starts: `docker compose ps` shows all containers healthy
- [ ] Health endpoint returns 200: `curl http://staging-host:3100/health`
- [ ] Migrations applied: check via `docker exec <db-container> psql -U postgres -d myapp -c "\dt"`
- [ ] If RAG project: `/status` returns correct document count
- [ ] Smoke test passes
- [ ] Staging URL documented in `.workbench/environments.md`

## Files involved

| File | Action |
|------|--------|
| `.workbench/export/<project>/` | Created by `make export-stack` |
| `.workbench/export/<project>/.env.staging` | Created by you, NOT committed |
| `.workbench/environments.md` | Create/update with staging URL |
| `.gitignore` | Add `.env.staging`, `.env.production` |

## Common mistakes

- **Port collision on local staging**: Workbench already uses 3100, 5432, 6379. Set `PG_PORT`, `REDIS_PORT`, `API_PORT` to different values in `.env.staging` when running on the same machine.
- **Forgetting `-p` project name**: Without `-p myapp-staging`, Docker Compose uses the directory name as the project name, which can collide with the workbench stack's volumes.
- **Seeding from wrong database**: `make backup-project NAME=myapp` backs up the workbench-registered project database, which is the RAG knowledgebase — not your application's user data if it lives elsewhere.
- **Committing `.env.staging`**: Add all `.env.*` variants (except `.env.example`) to `.gitignore` before creating them.
- **Not rebuilding images after code changes**: `docker compose --env-file .env.staging up -d` won't rebuild. Use `docker compose --env-file .env.staging up -d --build` when deploying new code.
