#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  AI Dev Workbench — Bootstrap Script                        ║
# ║  Run once after cloning. Handles everything:                ║
# ║    .env setup → build → start → MCP registration → auth    ║
# ╚══════════════════════════════════════════════════════════════╝

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$ROOT_DIR"

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

# ── Step 1: Environment file ─────────────────────────────
echo ""
echo -e "${CYAN}═══ Step 1/5: Environment Configuration ═══${NC}"

if [ ! -f .env ]; then
  cp .env.example .env
  warn "Created .env from template."
  echo ""
  echo "  You MUST fill in your API keys before continuing:"
  echo "    ANTHROPIC_API_KEY   — from console.anthropic.com"
  echo "    OPENROUTER_API_KEY  — from openrouter.ai/settings"
  echo "    POSTGRES_PASSWORD   — choose a strong password"
  echo "    JWT_SECRET          — at least 32 characters"
  echo ""
  echo "  Edit the file:"
  echo "    nano .env"
  echo ""
  echo "  Then re-run this script:"
  echo "    bash infra/scripts/bootstrap.sh"
  echo ""
  exit 0
fi

# Validate required keys are set
source .env 2>/dev/null || true
MISSING=()
[[ "${ANTHROPIC_API_KEY:-}" == sk-ant-* ]] || MISSING+=("ANTHROPIC_API_KEY")
[[ "${OPENROUTER_API_KEY:-}" == sk-or-* ]] || MISSING+=("OPENROUTER_API_KEY")
[[ -n "${POSTGRES_PASSWORD:-}" && "${POSTGRES_PASSWORD:-}" != "your-super-secret-postgres-password" ]] || MISSING+=("POSTGRES_PASSWORD")
[[ -n "${JWT_SECRET:-}" && "${JWT_SECRET:-}" != "your-super-secret-jwt-token-at-least-32-chars" ]] || MISSING+=("JWT_SECRET")

if [ ${#MISSING[@]} -gt 0 ]; then
  fail "Missing or placeholder values in .env: ${MISSING[*]}"
fi

ok "Environment file validated"

# ── Step 2: Build containers ─────────────────────────────
echo ""
echo -e "${CYAN}═══ Step 2/5: Building Containers ═══${NC}"
info "This may take a few minutes on first run..."

docker compose build --parallel 2>&1 | tail -5
ok "All containers built"

# ── Step 3: Start services ───────────────────────────────
echo ""
echo -e "${CYAN}═══ Step 3/5: Starting Services ═══${NC}"

docker compose up -d
info "Waiting for services to become healthy..."

# Wait for critical services
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  HEALTHY=$(docker compose ps --format json 2>/dev/null | \
    grep -c '"Health":"healthy"' 2>/dev/null || echo "0")
  # We need at least mcp-server, supabase-db, and redis healthy
  if [ "$HEALTHY" -ge 3 ]; then
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  info "  Waiting... (${ELAPSED}s / ${TIMEOUT}s timeout)"
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  warn "Some services may not be healthy yet. Check: docker compose ps"
else
  ok "All critical services healthy"
fi

# ── Step 4: Register MCP bridge with Claude Code ────────
echo ""
echo -e "${CYAN}═══ Step 4/5: MCP Registration ═══${NC}"

# Check if MCP bridge is already registered
MCP_CHECK=$(docker exec claude-code claude mcp list 2>/dev/null || echo "")

if echo "$MCP_CHECK" | grep -q "workbench"; then
  ok "MCP bridge already registered"
else
  info "Registering workbench MCP bridge..."
  docker exec claude-code claude mcp add workbench \
    -s user \
    -- node /opt/mcp-bridge/index.js 2>/dev/null || true
  ok "MCP bridge registered"
fi

# ── Step 5: Test connectivity ────────────────────────────
echo ""
echo -e "${CYAN}═══ Step 5/5: Connectivity Test ═══${NC}"

# Test the HTTP API
HEALTH=$(curl -s http://localhost:${API_PORT:-3100}/health 2>/dev/null || echo '{}')
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  ok "MCP server API responding on :${API_PORT:-3100}"
else
  warn "MCP server API not responding yet — may still be starting"
fi

# Test database
DB_CHECK=$(docker exec supabase-db pg_isready -U postgres 2>/dev/null || echo "fail")
if echo "$DB_CHECK" | grep -q "accepting"; then
  ok "PostgreSQL ready"
else
  warn "PostgreSQL not ready yet"
fi

# Test Redis
REDIS_CHECK=$(docker exec redis redis-cli ping 2>/dev/null || echo "fail")
if [ "$REDIS_CHECK" = "PONG" ]; then
  ok "Redis ready"
else
  warn "Redis not ready yet"
fi

# ── Done ─────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Workbench is running!                           ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║  Start Claude Code:                              ║${NC}"
echo -e "${GREEN}║    make claude                                   ║${NC}"
echo -e "${GREEN}║    (or: docker exec -it claude-code claude)      ║${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║  First time: Claude Code will prompt you to      ║${NC}"
echo -e "${GREEN}║  authenticate via browser. The token is saved    ║${NC}"
echo -e "${GREEN}║  to the claude-auth volume and persists across   ║${NC}"
echo -e "${GREEN}║  rebuilds.                                       ║${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║  Test the API:                                   ║${NC}"
echo -e "${GREEN}║    curl http://localhost:${API_PORT:-3100}/health              ║${NC}"
echo -e "${GREEN}║    curl http://localhost:${API_PORT:-3100}/status              ║${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║  Grafana dashboards:                             ║${NC}"
echo -e "${GREEN}║    http://localhost:3200  (admin/admin)           ║${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}║  Inside Claude Code:                             ║${NC}"
echo -e "${GREEN}║    /status  — knowledgebase stats                ║${NC}"
echo -e "${GREEN}║    /ingest documents/file.txt                    ║${NC}"
echo -e "${GREEN}║    /query What is the refund policy?             ║${NC}"
echo -e "${GREEN}║                                                  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
