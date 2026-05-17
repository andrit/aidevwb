# ═══════════════════════════════════════════════════════════
# AI Dev Workbench — Dev Environment
#
# Smallest viable cloud deployment:
#   - Single-AZ (no multi-AZ redundancy)
#   - Smallest instance classes
#   - Short backup retention
#   - Force-delete enabled for easy teardown
#
# Usage:
#   cd infra/terraform/environments/dev
#   cp terraform.tfvars.example terraform.tfvars
#   # Fill in your values
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

  # ── Remote State (uncomment for team use) ──────────────
  # backend "s3" {
  #   bucket = "your-terraform-state-bucket"
  #   key    = "ai-dev-workbench/dev/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = "dev"
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
  environment        = "dev"
  vpc_cidr           = "10.0.0.0/16"
  availability_zones = ["${var.aws_region}a"]  # Single AZ for dev
}

module "secrets" {
  source = "../../modules/secrets"

  project_name       = var.project_name
  environment        = "dev"
  anthropic_api_key  = var.anthropic_api_key
  openrouter_api_key = var.openrouter_api_key
  postgres_password  = var.postgres_password
}

module "database" {
  source = "../../modules/database"

  project_name      = var.project_name
  environment       = "dev"
  private_subnet_ids = module.networking.private_subnet_ids
  security_group_id = module.networking.database_security_group_id
  master_password   = var.postgres_password

  instance_class    = "db.t4g.micro"   # Smallest Graviton instance
  allocated_storage = 20               # 20 GB
}

module "redis" {
  source = "../../modules/redis"

  project_name      = var.project_name
  environment       = "dev"
  private_subnet_ids = module.networking.private_subnet_ids
  security_group_id = module.networking.redis_security_group_id

  node_type       = "cache.t4g.micro"  # Smallest Graviton instance
  num_cache_nodes = 1                  # Single node
}

module "containers" {
  source = "../../modules/containers"

  project_name      = var.project_name
  environment       = "dev"
  aws_region        = var.aws_region
  private_subnet_ids = module.networking.private_subnet_ids
  security_group_id = module.networking.containers_security_group_id
  secret_arn        = module.secrets.secret_arn
  database_url      = module.database.database_url
  redis_url         = module.redis.redis_url

  embedding_model      = var.embedding_model
  embedding_dimensions = var.embedding_dimensions

  mcp_server_cpu    = 256   # 0.25 vCPU
  mcp_server_memory = 512   # 512 MB
  rag_worker_cpu    = 512   # 0.5 vCPU
  rag_worker_memory = 1024  # 1 GB
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

output "database_url" {
  value     = module.database.database_url
  sensitive = true
}
