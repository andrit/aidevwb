---
name: promote-to-production
description: Pre-production checklist and cutover procedure for promoting a staged release to production
metadata:
  type: skill
  domain: deployment
  triggers:
    - "go to production"
    - "promote to prod"
    - "production deploy"
    - "release to production"
    - "ship it"
    - "cutover"
  capability_contracts:
    - provides: [rest_api]
    - consumes: []
---

# Skill: Promote to Production

## When to use

After staging has been validated and you're ready to ship. Run this checklist every time — even for small changes. The cost of five minutes on the checklist is far lower than a production incident.

## Prerequisites

- Staging environment is running and smoke tests pass (see `setup-staging-environment` skill)
- All changes are committed and pushed
- You know the production infrastructure target: Docker Compose on a VM, or Terraform on AWS
- You have production credentials (API keys, DB password, host access)

## Steps

### 1. Pre-flight checklist (do not skip)

Go through each item. Only proceed when all pass.

**Code**
- [ ] All tests pass: `npm test` (or `pytest`) locally and in CI
- [ ] No TODO/FIXME markers in code being shipped
- [ ] Staging has been running the same commit for at least one complete test cycle

**Database**
- [ ] All migrations have been tested on staging (check staging DB schema matches expectations)
- [ ] Migrations are idempotent — safe to re-run if deployment is retried
- [ ] If this is a first production deploy: migrations will run automatically via `docker-entrypoint-initdb.d`
- [ ] If production DB already exists: run migrations manually before cutting over (see step 4)

**Secrets**
- [ ] Production uses different credentials than staging (never share DB passwords or API keys)
- [ ] API keys are the production tier (not free tier / test keys)
- [ ] Secrets are NOT in git, `.env` file, or any committed artifact

**Config**
- [ ] `CLAUDE_MODEL` is set to production model (staging may use a cheaper model)
- [ ] `EMBEDDING_MODEL` + `EMBEDDING_DIMENSIONS` match whatever model was used to build the knowledgebase
- [ ] Resource limits are appropriate for production load (not staging's minimal limits)

**Observability**
- [ ] Health endpoint exists and returns 200
- [ ] You know where to look for errors (logs, Grafana if deployed)
- [ ] You have a rollback plan (see step 7)

### 2. Export the production artifact

```bash
make export-stack NAME=myapp FORMAT=compose
# or for Terraform-managed infra:
make export-stack NAME=myapp FORMAT=terraform
```

Inspect the export diff from your last production deploy (if applicable):
```bash
diff .workbench/export/myapp/docker-compose.yml /path/to/last-prod-export/docker-compose.yml
```

### 3a. Docker Compose deploy (VM / single host)

Create production env file on the production host. Do this on the host directly — never transfer secrets over the network unencrypted.

```bash
# On production host:
cd /opt/myapp
cp env.example .env
nano .env  # fill in production values
```

Deploy:
```bash
# First deploy:
docker compose up -d

# Update deploy (existing production):
docker compose pull          # pull new images if using registry
docker compose up -d --build # rebuild from source if not using registry
```

### 3b. Terraform deploy (AWS ECS)

```bash
# From workbench:
make deploy-prod
# or directly:
cd infra/terraform/environments/prod
terraform plan   # review changes
terraform apply
```

### 4. Run database migrations (existing production DB only)

If this is NOT a first deploy, run migrations manually before or immediately after cutover to avoid downtime from schema drift:

```bash
# On production host, connect to production DB:
docker exec -it myapp-db psql -U postgres -d myapp

# Check which migrations have run:
\dt  -- look for your tables

# Apply any missing migrations manually:
\i /app/migrations/005_conversations.sql
\i /app/migrations/006_memory_eval.sql
```

### 5. Verify production is healthy

```bash
# Basic health
curl https://api.myapp.com/health

# If RAG project:
curl https://api.myapp.com/status

# Check logs for errors (first 2 minutes are the most likely to show problems):
docker compose logs --tail=100 -f api
```

### 6. Cutover (if replacing an existing deployment)

If you're replacing a running production instance:

1. Put the old instance in maintenance mode if possible (return 503 from `/health`)
2. Verify new instance is healthy (step 5 passes)
3. Update DNS / load balancer to point to new instance
4. Verify traffic is flowing to new instance
5. Keep old instance running for 15 minutes as fallback
6. Shut down old instance

### 7. Rollback plan

Keep this ready before you cut over.

**Docker Compose rollback:**
```bash
# Rollback to previous image tag (if using a registry):
docker compose down
# edit docker-compose.yml to use previous image tag
docker compose up -d

# Rollback database (if migration caused the issue):
make restore-project NAME=myapp BACKUP=backups/myapp-pre-deploy.sql.gz
```

**Terraform rollback:**
```bash
cd infra/terraform/environments/prod
terraform state list          # identify affected resources
git checkout HEAD~1 -- .     # revert to previous Terraform config
terraform apply               # apply rollback
```

### 8. Post-deploy

- [ ] Update `.workbench/environments.md` with new production deploy date and commit SHA
- [ ] Monitor for 30 minutes: error rate, response times, job queue depth
- [ ] Tag the release in git: `git tag v<version> && git push --tags`
- [ ] Update `CHANGELOG.md` if your project has one

## Templates

### Pre-deploy backup (always run before a production deploy)

```bash
# Backup workbench RAG database before deploy
make backup-project NAME=myapp
# Backup stored at: backups/myapp-<timestamp>.sql.gz
```

### Production `.env` structure

```bash
# Production .env — on production host only, never committed
# Last updated: <date> by <name>

# === REQUIRED ===
POSTGRES_PASSWORD=<strong-unique-password-not-shared-with-staging>
ANTHROPIC_API_KEY=<production-api-key>

# === EMBEDDING ===
EMBEDDING_BASE_URL=http://ollama:11434/v1  # or cloud provider
EMBEDDING_API_KEY=ollama
EMBEDDING_MODEL=mxbai-embed-large
EMBEDDING_DIMENSIONS=1024

# === MODELS ===
CLAUDE_MODEL=claude-sonnet-4-6  # production-grade model

# === INFRA ===
# API_PORT=3100       # default, change if needed
# PG_PORT=5432        # default
# REDIS_PORT=6379     # default
```

### Environments tracking file

```markdown
# .workbench/environments.md

## Environments

| Environment | URL | Deployed commit | Last deployed |
|-------------|-----|----------------|--------------|
| Dev (workbench) | http://localhost:3100 | always current | always current |
| Staging | http://staging.myapp.internal:3100 | abc1234 | 2026-05-30 |
| Production | https://api.myapp.com | abc1234 | 2026-05-30 |

## Rollback targets

| Environment | Last known good backup | Location |
|-------------|----------------------|----------|
| Production | 2026-05-30 pre-deploy | backups/myapp-20260530-120000.sql.gz |
```

## Checklist

- [ ] Pre-flight checklist complete (step 1) — every item checked
- [ ] Production backup taken before deploy
- [ ] Migrations verified on staging before promote
- [ ] Health check passes on production
- [ ] No error spikes in logs in first 2 minutes
- [ ] Rollback plan written down and tested (at least mentally)
- [ ] `.workbench/environments.md` updated
- [ ] Release tagged in git

## Files involved

| File | Action |
|------|--------|
| `.workbench/export/<project>/` | Updated by `make export-stack` |
| `.workbench/environments.md` | Update with deploy date + commit |
| `backups/<project>-<timestamp>.sql.gz` | Created by `make backup-project` before deploy |
| Production host `.env` | Managed on production host only, never in git |

## Common mistakes

- **Using staging secrets in production**: Always generate fresh passwords for each environment. `openssl rand -base64 32` generates a strong password.
- **Skipping the pre-flight**: The temptation is always strongest on small changes. That's when it bites you.
- **Deploying without a backup**: `make backup-project` takes 30 seconds. A corrupt production database takes hours to recover without one.
- **Not testing migrations on staging first**: Migrations that work in development can fail on production data due to constraint violations, NULL values, or size. Always test on staging data first.
- **Forgetting `--build` on source-based deploys**: If you're building images on the host (not pulling from a registry), `docker compose up -d` without `--build` runs the old image silently.
- **Shared DB password between staging and production**: If a staging `.env` leaks, it shouldn't give access to production. Use different passwords.
