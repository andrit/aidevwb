# ═══════════════════════════════════════════════════════════
# AI Dev Workbench — Prod Environment
#
# Production-grade deployment:
#   - Multi-AZ (2 availability zones)
#   - Larger instance classes
#   - 7-day backup retention
#   - Encryption at rest
#   - Container Insights enabled
#
# Usage:
#   cd infra/terraform/environments/prod
#   cp terraform.tfvars.example terraform.tfvars
#   terraform init
#   terraform plan
#   terraform apply
# ═══════════════════════════════════════════════════════════

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # ── Remote State (strongly recommended for prod) ───────
  # backend "s3" {
  #   bucket         = "your-terraform-state-bucket"
  #   key            = "ai-dev-workbench/prod/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

# ── Variables ─────────────────────────────────────────────

variable "project_name" {
  type    = string
  default = "ai-workbench"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

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

variable "embedding_model" {
  type    = string
  default = "voyage/voyage-3"
}

variable "embedding_dimensions" {
  type    = number
  default = 1024
}

# ── Modules ───────────────────────────────────────────────

module "networking" {
  source = "../../modules/networking"

  project_name       = var.project_name
  environment        = "prod"
  vpc_cidr           = "10.0.0.0/16"
  availability_zones = ["${var.aws_region}a", "${var.aws_region}b"]  # Multi-AZ
}

module "secrets" {
  source = "../../modules/secrets"

  project_name       = var.project_name
  environment        = "prod"
  anthropic_api_key  = var.anthropic_api_key
  openrouter_api_key = var.openrouter_api_key
  postgres_password  = var.postgres_password
}

module "database" {
  source = "../../modules/database"

  project_name      = var.project_name
  environment       = "prod"
  private_subnet_ids = module.networking.private_subnet_ids
  security_group_id = module.networking.database_security_group_id
  master_password   = var.postgres_password

  instance_class    = "db.r6g.large"   # Production Graviton instance
  allocated_storage = 100              # 100 GB, auto-scales to 200
}

module "redis" {
  source = "../../modules/redis"

  project_name      = var.project_name
  environment       = "prod"
  private_subnet_ids = module.networking.private_subnet_ids
  security_group_id = module.networking.redis_security_group_id

  node_type       = "cache.r6g.large"  # Production Graviton instance
  num_cache_nodes = 2                  # Multi-node for redundancy
}

module "containers" {
  source = "../../modules/containers"

  project_name      = var.project_name
  environment       = "prod"
  aws_region        = var.aws_region
  private_subnet_ids = module.networking.private_subnet_ids
  security_group_id = module.networking.containers_security_group_id
  secret_arn        = module.secrets.secret_arn
  database_url      = module.database.database_url
  redis_url         = module.redis.redis_url

  embedding_model      = var.embedding_model
  embedding_dimensions = var.embedding_dimensions

  mcp_server_cpu    = 1024  # 1 vCPU
  mcp_server_memory = 2048  # 2 GB
  rag_worker_cpu    = 2048  # 2 vCPU
  rag_worker_memory = 4096  # 4 GB
}

# ── Outputs ───────────────────────────────────────────────

output "vpc_id" {
  value = module.networking.vpc_id
}

output "database_endpoint" {
  value = module.database.endpoint
}

output "redis_endpoint" {
  value = module.redis.endpoint
}

output "ecs_cluster" {
  value = module.containers.cluster_name
}

output "mcp_server_ecr_url" {
  value = module.containers.mcp_server_ecr_url
}

output "rag_worker_ecr_url" {
  value = module.containers.rag_worker_ecr_url
}
