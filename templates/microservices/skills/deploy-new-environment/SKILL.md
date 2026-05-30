---
name: deploy-new-environment
description: Provision and validate a new deployment environment (staging or production) — Terraform apply, smoke tests, rollback plan, and environment promotion gate
domain: microservices
type: microservices
triggers:
  - "deploy to staging"
  - "deploy to production"
  - "new environment"
  - "promote to production"
  - "first deployment"
  - "environment promotion"
  - "launch to prod"
  - "go live"
  - "ship it"
  - "production deploy"
---

# Deploy a New Environment

## When to use

When deploying the full microservices stack to a new environment for the first time (staging or production), or when promoting a tested staging build to production. Activate when the user says "deploy to staging", "go to production", "promote the build", or "first deploy."

See `seed-docs/terraform-iac.md` and `production-readiness-review` skill.

## Prerequisites

- All services have Terraform modules (see `add-terraform-module` skill)
- Production readiness review completed and signed off (see `production-readiness-review` skill)
- All service Docker images built and pushed to ECR/registry
- Secrets provisioned in secrets manager (not in any file)
- DNS zone and SSL certificates exist (or are provisioned as part of this deploy)
- Rollback plan written before deploy begins

## The Deploy Sequence

Always deploy in this order. Each stage gates the next — don't proceed if the current stage fails.

```
1. Provision infrastructure (Terraform)
2. Run database migrations
3. Deploy services (rolling update)
4. Run smoke tests
5. Enable traffic (flip DNS or load balancer weights)
6. Monitor for 30 minutes
7. Proceed or rollback
```

## Steps

### 1. Pre-deploy checklist (run before anything)

```bash
# Verify all image tags exist in the registry
aws ecr describe-images \
  --repository-name <name>-service-staging \
  --image-ids imageTag=v1.0.0 \
  --query "imageDetails[0].imageTags"

# Verify secrets exist in secrets manager
aws secretsmanager list-secrets \
  --filters Key=name,Values="/<service>/staging/" \
  --query "SecretList[*].Name"

# Verify Terraform state is clean (no pending operations)
cd terraform/environments/staging
terraform plan -detailed-exitcode
# Exit 0 = no changes, Exit 1 = error, Exit 2 = changes needed
```

### 2. Provision infrastructure with Terraform

```bash
cd terraform/environments/staging

# Always plan first — never apply without reviewing
terraform plan \
  -var="<service>_image_tag=v1.0.0" \
  -out=staging.tfplan

# Review the plan — specifically look for any destroys:
# "# aws_db_instance.orders will be destroyed" is a red flag
grep -E "will be (created|updated|destroyed|replaced)" staging.tfplan.txt

# Apply only after plan review
terraform apply staging.tfplan

# Verify service is running
aws ecs describe-services \
  --cluster <cluster-name> \
  --services orders-service-staging \
  --query "services[0].{status:status,running:runningCount,desired:desiredCount,events:events[0:3]}"
```

### 3. Run database migrations

Run migrations as a one-time ECS task, not as part of service startup:

```bash
# Run migration as a one-off ECS task (not a service — exits after completion)
aws ecs run-task \
  --cluster <cluster-name> \
  --task-definition orders-service-staging \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<subnet-id>],securityGroups=[<sg-id>]}" \
  --overrides '{"containerOverrides":[{"name":"orders-service","command":["node","dist/migrate.js"]}]}'

# Wait for the task to complete
TASK_ARN=$(aws ecs run-task ... --query "tasks[0].taskArn" --output text)
aws ecs wait tasks-stopped --cluster <cluster> --tasks $TASK_ARN

# Check exit code (0 = success)
aws ecs describe-tasks \
  --cluster <cluster> \
  --tasks $TASK_ARN \
  --query "tasks[0].containers[0].exitCode"
```

### 4. Run smoke tests

Smoke tests verify that the deployed system works end-to-end — not just that containers started:

```bash
# scripts/smoke-test.sh — run after every deploy
#!/bin/bash
set -e

BASE_URL="${1:-https://api-staging.example.com}"

echo "=== Smoke Tests: $BASE_URL ==="

# Health checks
echo "[1] Liveness probe..."
curl -sf "$BASE_URL/orders/health/live" | grep -q '"status":"ok"'
echo "  ✓ Liveness OK"

echo "[2] Readiness probe..."
curl -sf "$BASE_URL/orders/health/ready" | grep -q '"status":"ok"'
echo "  ✓ Readiness OK"

# Authentication
echo "[3] Auth required for protected routes..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/orders/api/orders")
[ "$STATUS" = "401" ] && echo "  ✓ Auth enforced" || (echo "  ✗ Auth NOT enforced (got $STATUS)"; exit 1)

# Core business operation (create → read → verify)
echo "[4] Create order..."
ORDER=$(curl -sf -X POST "$BASE_URL/orders/api/orders" \
  -H "Authorization: Bearer $SMOKE_TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"smoke-test","items":[{"sku":"TEST-001","qty":1}]}')
ORDER_ID=$(echo "$ORDER" | jq -r '.id')
[ "$ORDER_ID" != "null" ] && echo "  ✓ Order created: $ORDER_ID" || (echo "  ✗ Order creation failed"; exit 1)

echo "[5] Read order back..."
curl -sf "$BASE_URL/orders/api/orders/$ORDER_ID" \
  -H "Authorization: Bearer $SMOKE_TEST_TOKEN" | grep -q "\"id\":\"$ORDER_ID\""
echo "  ✓ Order readable"

echo ""
echo "=== All smoke tests passed ==="
```

```bash
# Run the smoke test
SMOKE_TEST_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id /smoke-test/staging-token --query SecretString --output text)

bash scripts/smoke-test.sh https://api-staging.example.com
```

### 5. Environment promotion gate

Before promoting from staging to production, complete this checklist:

```markdown
## Staging → Production Promotion Gate

**Build:** v1.0.0
**Date:** <date>
**Deployed to staging:** <timestamp>
**Smoke tests passed:** ✅/❌
**Load test (if applicable):** ✅/❌

### Required approvals
- [ ] Engineering lead reviewed smoke test results
- [ ] No open P0/P1 bugs on this build
- [ ] On-call rotation aware of the deploy
- [ ] Rollback procedure confirmed (tested in staging?)
- [ ] Maintenance window communicated (if any)

### Proceed?
- [ ] Go: apply staging config to production
- [ ] No-go: reason ________________
```

### 6. Production deploy

After the promotion gate is approved:

```bash
# Production deploy uses same process as staging
cd terraform/environments/production

terraform plan \
  -var="orders_image_tag=v1.0.0" \
  -out=production.tfplan

# Check for any destroys — refuse if unexpected destroys appear
grep "will be destroyed" production.tfplan.txt && echo "WARNING: resources will be destroyed" && exit 1

terraform apply production.tfplan

# Run smoke tests against production
bash scripts/smoke-test.sh https://api.example.com
```

### 7. Post-deploy monitoring (30 minutes)

After deploying to production, actively watch these signals for 30 minutes:

```bash
# Watch error rate in real time
aws logs tail /ecs/orders-service-production \
  --follow \
  --filter-pattern '{ $.level = "error" }'

# Check Grafana dashboard — watch for:
# - Error rate spike
# - Latency increase (p99 > SLO)
# - Memory leak (memory increasing monotonically)
# - DB connection saturation

# Check that request count is flowing (traffic is reaching the service)
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name RequestCount \
  --dimensions Name=TargetGroup,Value=<tg-arn> \
  --start-time $(date -u -d "-5 minutes" +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum
```

### 8. Rollback procedure

If anything is wrong within the 30-minute monitoring window:

```bash
# Option A: roll back to the previous image tag (fastest)
cd terraform/environments/production
terraform apply -var="orders_image_tag=v0.9.5"
# ECS does a rolling update back to the previous version

# Option B: reduce desired count to 0 (if service is actively causing harm)
aws ecs update-service \
  --cluster <cluster> \
  --service orders-service-production \
  --desired-count 0

# Verify rollback
aws ecs describe-services \
  --cluster <cluster> \
  --services orders-service-production \
  --query "services[0].{running:runningCount,desired:desiredCount,taskDef:taskDefinition}"
```

Write down the rollback command in the deploy checklist before deploying — don't figure it out under pressure.

## Templates

### deploy.sh — parameterized deploy script

```bash
#!/bin/bash
# scripts/deploy.sh <environment> <image_tag>
set -euo pipefail

ENVIRONMENT="${1:?environment required}"
IMAGE_TAG="${2:?image_tag required}"

echo "Deploying $IMAGE_TAG to $ENVIRONMENT"

cd "terraform/environments/$ENVIRONMENT"

terraform plan -var="orders_image_tag=$IMAGE_TAG" -out=deploy.tfplan
terraform apply deploy.tfplan

echo "Running smoke tests..."
bash ../../scripts/smoke-test.sh "$BASE_URL"

echo "Deploy complete: $IMAGE_TAG → $ENVIRONMENT"
```

### Runbook: new environment first-time setup

```
1. Create secrets in AWS Secrets Manager (db passwords, API keys)
2. Run terraform init in environments/<env>/
3. Run terraform plan — review output
4. Run terraform apply — provision infrastructure
5. Run migrations (ECS run-task with migrate.js command)
6. Push first Docker image to ECR
7. Run terraform apply again with the image tag
8. Run smoke tests
9. Point DNS to the new load balancer
10. Monitor for 30 minutes
```

## Checklist

- [ ] Pre-deploy checklist completed (image tags exist, secrets provisioned, Terraform state clean)
- [ ] `terraform plan` reviewed before `terraform apply` — no unexpected destroys
- [ ] Database migrations run as one-off ECS task, not on service startup
- [ ] Smoke test script exists at `scripts/smoke-test.sh` and covers health + auth + core operation
- [ ] Smoke tests passed in staging before promoting to production
- [ ] Promotion gate completed with required sign-offs
- [ ] Rollback command written down before starting production deploy
- [ ] 30-minute post-deploy monitoring completed (error rate, latency, memory stable)
- [ ] Deploy runbook updated with any deviations from the standard process

## Files involved

| File | Action |
|------|--------|
| `scripts/smoke-test.sh` | Create: health + auth + core operation smoke tests |
| `scripts/deploy.sh` | Create: parameterized deploy script |
| `terraform/environments/<env>/terraform.tfvars` | Update: image tags for new deploy |
| `docs/runbook.md` | Update: document the new environment and its promotion gate |

## Common mistakes

**Running terraform apply without reviewing plan** — a plan that shows a database being destroyed and recreated will drop all data. Always read the plan output before applying. Specifically grep for "will be destroyed" and "must be replaced."

**Migrations on service startup** — running `runMigrations()` in `index.ts` means every instance races to apply the same migration on startup. The second instance fails on the already-applied migration, or worse, there's a window where some instances are running old code against new schema. Run migrations as a separate one-off task before the service rollout.

**No rollback plan** — a rollback written under production-down pressure is a recipe for mistakes. Write the exact rollback command in the promotion gate document before starting the deploy.

**Deploying to production without staging validation** — staging must use the same Terraform modules and same infrastructure config (not the workbench Docker Compose) as production. A staging environment that uses workbench internals gives you false confidence.

**No smoke tests** — "the containers started" is not the same as "the service works." Smoke tests verify that traffic flows end-to-end through the deployed system. They catch misconfigured env vars, missing secrets, and network ACL issues that health checks can't detect.
