# ═══════════════════════════════════════════════════════════
# Secrets Module — AWS Secrets Manager
#
# Cloud equivalent of the local .env file.
# Stores API keys and credentials, referenced by ECS tasks.
# ═══════════════════════════════════════════════════════════

variable "project_name" { type = string }
variable "environment" { type = string }

variable "anthropic_api_key" {
  type      = string
  sensitive = true
}

variable "openrouter_api_key" {
  type      = string
  sensitive = true
}

variable "postgres_password" {
  type      = string
  sensitive = true
}

# ── Secrets ──────────────────────────────────────────────

resource "aws_secretsmanager_secret" "workbench" {
  name                    = "${var.project_name}/${var.environment}/config"
  description             = "AI Dev Workbench API keys and configuration"
  recovery_window_in_days = var.environment == "prod" ? 7 : 0

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "workbench" {
  secret_id = aws_secretsmanager_secret.workbench.id
  secret_string = jsonencode({
    ANTHROPIC_API_KEY  = var.anthropic_api_key
    OPENROUTER_API_KEY = var.openrouter_api_key
    POSTGRES_PASSWORD  = var.postgres_password
  })
}

# ── Outputs ──────────────────────────────────────────────

output "secret_arn" {
  value = aws_secretsmanager_secret.workbench.arn
}

output "secret_name" {
  value = aws_secretsmanager_secret.workbench.name
}
