# AI Dev Workbench — Infrastructure as Code

## Strategy

The workbench uses a phased infrastructure approach:

**Phase 1 (current):** Docker Compose is the primary reproducibility layer. Everything runs locally. This is the default and covers most use cases — single developer, local-first, zero cloud dependency.

**Phase 2 (this directory):** Terraform/OpenTofu modules for provisioning cloud equivalents of the local stack. Use this when you need persistent cloud hosting, team access, or production deployment.

**Phase 3 (future):** Optional Kubernetes manifests for orchestrated deployments. Only needed at scale.

## What Gets Provisioned

The Terraform modules map 1:1 to the Docker Compose services:

| Local (Compose)        | Cloud (Terraform)                    | Module           |
|------------------------|--------------------------------------|------------------|
| supabase-db            | AWS RDS PostgreSQL + pgvector        | `database`       |
| redis                  | AWS ElastiCache Redis                | `redis`          |
| mcp-server, rag-worker | AWS ECS Fargate tasks                | `containers`     |
| workbench-network      | AWS VPC + private subnets            | `networking`     |
| .env                   | AWS Secrets Manager                  | `secrets`        |
| grafana, tempo, otel   | (not provisioned — use Grafana Cloud or self-host on ECS) |

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5 or [OpenTofu](https://opentofu.org/docs/intro/install/) >= 1.6
- AWS CLI configured with credentials (`aws configure`)
- An S3 bucket for Terraform state (or use local state for experiments)

## Quick Start

```bash
cd infra/terraform/environments/dev

# Review and edit variables
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars

# Initialize
terraform init

# Preview changes
terraform plan

# Apply
terraform apply
```

## Environments

- `environments/dev/` — smaller instances, lower cost, single-AZ
- `environments/prod/` — multi-AZ, larger instances, encryption at rest

Each environment is a root module that composes the shared modules in `modules/`.

## Module Reference

### networking
VPC with public and private subnets, NAT gateway, security groups.

### database
RDS PostgreSQL 15 with pgvector extension. Private subnet only. Outputs connection string for other modules.

### redis
ElastiCache Redis 7 cluster. Private subnet only. Single node (dev) or multi-node (prod).

### containers
ECS Fargate cluster with task definitions for mcp-server and rag-worker. Pulls images from ECR.

### secrets
Secrets Manager entries for API keys. Referenced by ECS task definitions.

## Adapting to Other Providers

The modules are AWS-specific but the structure is portable. To adapt:

- **GCP:** Replace RDS with Cloud SQL, ElastiCache with Memorystore, ECS with Cloud Run, VPC with GCP VPC.
- **Azure:** Replace RDS with Azure Database for PostgreSQL, ElastiCache with Azure Cache for Redis, ECS with Azure Container Apps.
- **Fly.io / Railway / Render:** These PaaS providers don't need Terraform — use their CLI or dashboard directly. The Docker images build unchanged.

## State Management

For team use, configure remote state in the environment's `backend.tf`:

```hcl
terraform {
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "ai-dev-workbench/dev/terraform.tfstate"
    region = "us-east-1"
  }
}
```

For solo experiments, local state is fine (the default).
