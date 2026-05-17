# ╔══════════════════════════════════════════════════════════════╗
# ║  AI Dev Workbench — Makefile                                ║
# ╚══════════════════════════════════════════════════════════════╝

.PHONY: help up down build clean claude status logs studio neo4j init

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ── Setup ─────────────────────────────────────────────────

init: ## First-time setup: env → build → start → MCP registration
	@bash infra/scripts/bootstrap.sh

register-mcp: ## Re-register MCP bridge with Claude Code
	@bash infra/scripts/register-mcp.sh

# ── Core ──────────────────────────────────────────────────

up: ## Start all core services
	docker compose up -d

down: ## Stop all services (preserves volumes)
	docker compose down

build: ## Build/rebuild all containers
	docker compose build

clean: ## Stop and remove everything including volumes
	docker compose down -v
	docker compose --profile neo4j --profile studio down -v

# ── Claude Code ───────────────────────────────────────────

claude: ## Attach to Claude Code interactive session
	docker exec -it claude-code claude

claude-cmd: ## Run a one-shot Claude Code command (usage: make claude-cmd CMD="your prompt")
	docker exec -it claude-code claude -p "$(CMD)"

# ── Project Management ───────────────────────────────────

project: ## Register an existing project (usage: make project NAME=nexus DIR=~/code/nexus TYPE=fullstack)
	@curl -sf -X POST http://localhost:$${API_PORT:-3100}/scaffold \
		-H "Content-Type: application/json" \
		-d "{\"name\": \"$(NAME)\", \"directory\": \"$(DIR)\", \"type\": \"$(or $(TYPE),custom)\"$(if $(FRAMEWORK),, \"framework\": \"$(FRAMEWORK)\")}" \
		| python3 -m json.tool
	@echo ""
	@echo "  To start working:"
	@echo "    WORKBENCH_PROJECT=$(NAME) PROJECT_DIR=$(DIR) docker compose up -d claude-code"
	@echo "    make claude"

scaffold: ## Create a new project from template (usage: make scaffold NAME=myapp TYPE=fullstack)
	@mkdir -p "$(or $(DIR),workspace/$(NAME))"
	@curl -sf -X POST http://localhost:$${API_PORT:-3100}/scaffold \
		-H "Content-Type: application/json" \
		-d "{\"name\": \"$(NAME)\", \"directory\": \"$(or $(DIR),/workspace/$(NAME))\", \"type\": \"$(or $(TYPE),custom)\"$(if $(FRAMEWORK),, \"framework\": \"$(FRAMEWORK)\")}" \
		| python3 -m json.tool

list-projects: ## List all registered projects
	@curl -sf http://localhost:$${API_PORT:-3100}/projects | python3 -m json.tool

drop-project: ## Drop a project and its database (usage: make drop-project NAME=nexus)
	@echo "⚠️  This will delete the '$(NAME)' database and all its RAG data."
	@read -p "  Continue? [y/N] " confirm && [ "$$confirm" = "y" ] && \
		curl -sf -X DELETE http://localhost:$${API_PORT:-3100}/projects/$(NAME) | python3 -m json.tool || echo "Aborted."

backup-project: ## Backup a project's database (usage: make backup-project NAME=nexus)
	@echo "▸ Backing up project '$(NAME)'..."
	@mkdir -p backups
	@docker exec supabase-db pg_dump -U postgres --no-owner --no-privileges --clean --if-exists $(NAME) \
		| gzip > backups/$(NAME)-$$(date +%Y%m%d-%H%M%S).sql.gz
	@echo "✓ Backup: backups/$(NAME)-$$(date +%Y%m%d-%H%M%S).sql.gz"

restore-project: ## Restore a project's database (usage: make restore-project NAME=nexus BACKUP=backups/file.sql.gz)
	@echo "▸ Restoring project '$(NAME)' from $(BACKUP)..."
	@gunzip -c $(BACKUP) | docker exec -i supabase-db psql -U postgres -d $(NAME) --quiet 2>&1 | head -5
	@echo "✓ Restored."

# ── Optional Profiles ────────────────────────────────────

studio: ## Start with Supabase Studio (web UI at :3001)
	docker compose --profile studio up -d

neo4j: ## Start with Neo4j (browser at :7474, bolt at :7687)
	docker compose --profile neo4j up -d

all: ## Start everything including all optional services
	docker compose --profile studio --profile neo4j up -d

# ── Operations ────────────────────────────────────────────

status: ## Show service status and RAG stats
	@docker compose ps
	@echo ""
	@echo "── RAG Status ──"
	@curl -s http://localhost:3100/status 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "MCP server not responding"

logs: ## Tail logs from all services
	docker compose logs -f --tail=50

logs-mcp: ## Tail MCP server logs
	docker compose logs -f mcp-server

logs-worker: ## Tail RAG worker logs
	docker compose logs -f rag-worker

# ── Database ─────────────────────────────────────────────

db-shell: ## Open psql shell in Supabase database
	docker exec -it supabase-db psql -U postgres

backup: ## Backup database to backups/ (portable, travels with repo)
	@bash infra/scripts/backup.sh

restore: ## Restore database from backup (usage: make restore or make restore BACKUP=backups/file.sql.gz)
	@bash infra/scripts/restore.sh $(BACKUP)

# ── Testing ───────────────────────────────────────────────

test-health: ## Test API health endpoint
	curl -s http://localhost:3100/health | python3 -m json.tool

test-ingest: ## Test ingestion with sample document
	@echo "Creating sample document..."
	@mkdir -p documents
	@echo "This is a test document for the AI Dev Workbench." > documents/test.txt
	curl -s -X POST http://localhost:3100/ingest \
		-H "Content-Type: application/json" \
		-d '{"filepath": "/workspace/documents/test.txt"}' | python3 -m json.tool

test-query: ## Test query (usage: make test-query Q="your question")
	curl -s -X POST http://localhost:3100/query \
		-H "Content-Type: application/json" \
		-d '{"question": "$(Q)"}' | python3 -m json.tool

smoke-test: ## Run automated smoke test checks (see docs/SMOKE-TEST.md for full guide)
	@echo "═══ Smoke Test — Automated Checks ═══"
	@echo ""
	@echo "── Docker ──"
	@docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || echo "❌ Docker Compose not running"
	@echo ""
	@echo "── Health Checks ──"
	@printf "  MCP Server:  " && (curl -sf http://localhost:3100/health > /dev/null && echo "✅" || echo "❌")
	@printf "  PostgreSQL:  " && (docker exec supabase-db pg_isready -U postgres > /dev/null 2>&1 && echo "✅" || echo "❌")
	@printf "  Redis:       " && (docker exec redis redis-cli ping > /dev/null 2>&1 && echo "✅" || echo "❌")
	@printf "  Grafana:     " && (curl -sf http://localhost:3200/api/health > /dev/null && echo "✅" || echo "❌")
	@printf "  OTel:        " && (curl -sf http://localhost:4318/ > /dev/null 2>&1 && echo "✅" || echo "⚠️  (may still be ok)")
	@echo ""
	@echo "── Database ──"
	@printf "  Extensions:  " && (docker exec supabase-db psql -U postgres -t -c "SELECT count(*) FROM pg_extension WHERE extname IN ('vector','pg_trgm');" 2>/dev/null | grep -q "2" && echo "✅ vector + pg_trgm" || echo "❌")
	@printf "  Tables:      " && (docker exec supabase-db psql -U postgres -t -c "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('documents','document_chunks');" 2>/dev/null | grep -q "2" && echo "✅ documents + document_chunks" || echo "❌")
	@printf "  hybrid_search: " && (docker exec supabase-db psql -U postgres -t -c "SELECT count(*) FROM pg_proc WHERE proname='hybrid_search';" 2>/dev/null | grep -q "1" && echo "✅" || echo "❌")
	@echo ""
	@echo "── RAG Status ──"
	@curl -s http://localhost:3100/status 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  ❌ Could not reach /status"
	@echo ""
	@echo "── MCP Bridge ──"
	@printf "  Installed:   " && (docker exec claude-code ls /opt/mcp-bridge/index.js > /dev/null 2>&1 && echo "✅" || echo "❌")
	@printf "  Network:     " && (docker exec claude-code wget -q -O /dev/null http://mcp-server:3100/health 2>&1 && echo "✅" || echo "❌")
	@echo ""
	@echo "For the full manual smoke test: cat docs/SMOKE-TEST.md"

# ── Cloud Deployment ─────────────────────────────────────

deploy-dev: ## Deploy to AWS dev (build + push + update ECS)
	@bash infra/scripts/deploy.sh dev

deploy-prod: ## Deploy to AWS prod (build + push + update ECS)
	@bash infra/scripts/deploy.sh prod

tf-init-dev: ## Initialize Terraform for dev environment
	cd infra/terraform/environments/dev && terraform init

tf-plan-dev: ## Preview Terraform changes for dev
	cd infra/terraform/environments/dev && terraform plan

tf-apply-dev: ## Apply Terraform changes for dev
	cd infra/terraform/environments/dev && terraform apply

tf-destroy-dev: ## Tear down dev cloud infrastructure
	cd infra/terraform/environments/dev && terraform destroy

# ── Export / Ship ─────────────────────────────────────────

export-stack: ## Export production stack for a project (usage: make export-stack NAME=nexus FORMAT=compose)
	@curl -sf -X POST http://localhost:$${API_PORT:-3100}/projects/$(NAME)/export \
		-H "Content-Type: application/json" \
		-d '{"format": "$(or $(FORMAT),compose)", "include_data": $(or $(DATA),false)}' \
		| python3 -m json.tool

export-with-data: ## Export stack + seed database dump (usage: make export-with-data NAME=nexus)
	@curl -sf -X POST http://localhost:$${API_PORT:-3100}/projects/$(NAME)/export \
		-H "Content-Type: application/json" \
		-d '{"format": "$(or $(FORMAT),compose)", "include_data": true}' \
		| python3 -m json.tool
