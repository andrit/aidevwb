# ═══════════════════════════════════════════════════════════
# Database Module — RDS PostgreSQL 15 + pgvector
#
# Cloud equivalent of the local supabase-db container.
# pgvector extension is available on RDS PostgreSQL 15.4+.
# ═══════════════════════════════════════════════════════════

variable "project_name" { type = string }
variable "environment" { type = string }

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the DB subnet group"
}

variable "security_group_id" {
  type        = string
  description = "Security group allowing PostgreSQL access"
}

variable "instance_class" {
  type        = string
  default     = "db.t4g.micro"
  description = "RDS instance class. t4g.micro for dev, r6g.large+ for prod."
}

variable "allocated_storage" {
  type        = number
  default     = 20
  description = "Storage in GB"
}

variable "master_password" {
  type        = string
  sensitive   = true
  description = "Master password for the postgres user"
}

# ── Subnet Group ─────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-db-subnet"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name        = "${var.project_name}-${var.environment}-db-subnet"
    Project     = var.project_name
    Environment = var.environment
  }
}

# ── Parameter Group (enable pgvector) ────────────────────

resource "aws_db_parameter_group" "postgres15" {
  family = "postgres15"
  name   = "${var.project_name}-${var.environment}-pg15"

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements,pgvector"
    apply_method = "pending-reboot"
  }

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# ── RDS Instance ─────────────────────────────────────────

resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-${var.environment}"
  engine         = "postgres"
  engine_version = "15.6"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.allocated_storage * 2
  storage_encrypted     = true

  db_name  = "postgres"
  username = "postgres"
  password = var.master_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.security_group_id]
  parameter_group_name   = aws_db_parameter_group.postgres15.name

  publicly_accessible = false
  skip_final_snapshot = var.environment == "dev"

  backup_retention_period = var.environment == "prod" ? 7 : 1
  multi_az                = var.environment == "prod"

  tags = {
    Name        = "${var.project_name}-${var.environment}-db"
    Project     = var.project_name
    Environment = var.environment
  }
}

# ── Outputs ──────────────────────────────────────────────

output "endpoint" {
  value = aws_db_instance.main.endpoint
}

output "database_url" {
  value     = "postgresql://postgres:${var.master_password}@${aws_db_instance.main.endpoint}/postgres"
  sensitive = true
}

output "host" {
  value = aws_db_instance.main.address
}

output "port" {
  value = aws_db_instance.main.port
}
