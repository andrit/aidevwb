#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  Deploy to AWS — build, push, and update ECS services       ║
# ║                                                              ║
# ║  Prerequisites:                                              ║
# ║    - AWS CLI configured (aws configure)                      ║
# ║    - Terraform applied (infra provisioned)                   ║
# ║    - Docker running                                          ║
# ║                                                              ║
# ║  Usage:                                                      ║
# ║    bash infra/scripts/deploy.sh dev                          ║
# ║    bash infra/scripts/deploy.sh prod                         ║
# ╚══════════════════════════════════════════════════════════════╝

set -euo pipefail

ENV="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TF_DIR="$ROOT_DIR/infra/terraform/environments/$ENV"

# ── Colors ────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}▸${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; exit 1; }

cd "$ROOT_DIR"

# ── Validate ──────────────────────────────────────────────

echo ""
echo -e "${CYAN}═══ Deploy to AWS ($ENV) ═══${NC}"
echo ""

[ -d "$TF_DIR" ] || fail "Environment '$ENV' not found at $TF_DIR"
command -v aws >/dev/null || fail "AWS CLI not installed"
command -v docker >/dev/null || fail "Docker not installed"
command -v terraform >/dev/null && TF_CMD="terraform" || {
  command -v tofu >/dev/null && TF_CMD="tofu" || fail "Neither terraform nor tofu found"
}

# ── Get ECR URLs from Terraform output ────────────────────

info "Reading Terraform outputs..."
cd "$TF_DIR"

MCP_ECR=$($TF_CMD output -raw mcp_server_ecr_url 2>/dev/null) || fail "Run 'terraform apply' first"
WORKER_ECR=$($TF_CMD output -raw rag_worker_ecr_url 2>/dev/null) || fail "Run 'terraform apply' first"
REGION=$(grep -oP 'aws_region\s*=\s*"\K[^"]+' terraform.tfvars 2>/dev/null || echo "us-east-1")
ACCOUNT_ID=$(echo "$MCP_ECR" | cut -d. -f1)

ok "MCP Server ECR: $MCP_ECR"
ok "RAG Worker ECR: $WORKER_ECR"

cd "$ROOT_DIR"

# ── Authenticate Docker with ECR ─────────────────────────

info "Authenticating Docker with ECR..."
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
ok "Docker authenticated with ECR"

# ── Build Images ─────────────────────────────────────────

info "Building MCP server image..."
docker build -t "$MCP_ECR:latest" \
  -f apps/mcp-server/Dockerfile \
  apps/mcp-server/
ok "MCP server image built"

info "Building RAG worker image..."
docker build -t "$WORKER_ECR:latest" \
  -f apps/rag-worker/Dockerfile \
  apps/rag-worker/
ok "RAG worker image built"

# ── Tag with git SHA for rollback tracking ────────────────

GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "nogit")
docker tag "$MCP_ECR:latest" "$MCP_ECR:$GIT_SHA"
docker tag "$WORKER_ECR:latest" "$WORKER_ECR:$GIT_SHA"
info "Tagged images with: latest, $GIT_SHA"

# ── Push Images ──────────────────────────────────────────

info "Pushing MCP server image..."
docker push "$MCP_ECR:latest"
docker push "$MCP_ECR:$GIT_SHA"
ok "MCP server pushed"

info "Pushing RAG worker image..."
docker push "$WORKER_ECR:latest"
docker push "$WORKER_ECR:$GIT_SHA"
ok "RAG worker pushed"

# ── Run Database Migrations ──────────────────────────────

info "Running database migrations..."

DB_URL=$($TF_CMD output -raw database_url 2>/dev/null -chdir="$TF_DIR") || warn "Could not read database_url"

if [ -n "${DB_URL:-}" ]; then
  for migration in supabase/migrations/*.sql; do
    migration_name=$(basename "$migration")
    info "  Applying: $migration_name"
    PGPASSWORD=$(echo "$DB_URL" | grep -oP '://[^:]+:\K[^@]+') \
      psql "$DB_URL" -f "$migration" 2>/dev/null || warn "  Migration may have already been applied: $migration_name"
  done
  ok "Migrations complete"
else
  warn "Skipping migrations — could not read database URL"
  echo "  Run manually: psql \$DATABASE_URL -f supabase/migrations/001_extensions.sql"
fi

# ── Force ECS Service Update ─────────────────────────────

info "Updating ECS services (force new deployment)..."

CLUSTER=$($TF_CMD output -raw ecs_cluster 2>/dev/null -chdir="$TF_DIR") || fail "Could not read ECS cluster name"

aws ecs update-service \
  --cluster "$CLUSTER" \
  --service mcp-server \
  --force-new-deployment \
  --region "$REGION" \
  --no-cli-pager > /dev/null
ok "MCP server service updated"

aws ecs update-service \
  --cluster "$CLUSTER" \
  --service rag-worker \
  --force-new-deployment \
  --region "$REGION" \
  --no-cli-pager > /dev/null
ok "RAG worker service updated"

# ── Done ─────────────────────────────────────────────────

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Deploy complete ($ENV)                          ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Images:  latest + $GIT_SHA                      ║${NC}"
echo -e "${GREEN}║  Cluster: $CLUSTER${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║  Monitor:                                        ║${NC}"
echo -e "${GREEN}║    aws ecs describe-services \\                   ║${NC}"
echo -e "${GREEN}║      --cluster $CLUSTER \\${NC}"
echo -e "${GREEN}║      --services mcp-server rag-worker             ║${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║  Logs:                                           ║${NC}"
echo -e "${GREEN}║    aws logs tail /ecs/$CLUSTER/mcp-server         ║${NC}"
echo -e "${GREEN}║    aws logs tail /ecs/$CLUSTER/rag-worker         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
