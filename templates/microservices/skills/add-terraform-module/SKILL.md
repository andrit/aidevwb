---
name: add-terraform-module
description: Create a reusable Terraform module for a new microservice — ECS/Kubernetes resources, RDS database, IAM roles, secrets manager integration, and environment promotion (staging → production)
domain: microservices
type: microservices
triggers:
  - "terraform module"
  - "add terraform"
  - "infrastructure as code"
  - "IaC for new service"
  - "deploy to AWS"
  - "deploy to ECS"
  - "deploy to Kubernetes"
  - "provisioning"
  - "new environment"
  - "terraform the service"
---

# Add a Terraform Module for a New Service

## When to use

When a new service needs to be provisioned in a real cloud environment — not just run locally with Docker Compose. Activate when the user says "add Terraform for this service", "deploy to staging", "provision the infrastructure", or "create the IaC module."

See `seed-docs/terraform-iac.md` for the full Terraform reference.

## Prerequisites

- Service scaffolded and running locally (see `add-new-service` skill)
- Existing `terraform/` directory with shared modules (`vpc`, `rds`, `ecs-cluster`) already defined
- AWS CLI configured or cloud credentials available
- `terraform init` run in the relevant environment directory
- Secrets management backend chosen: AWS SSM Parameter Store or AWS Secrets Manager
- Decision made: ECS (simpler) or Kubernetes (more control)?

## Terraform Project Structure

```
terraform/
├── modules/
│   ├── ecs-service/         — reusable ECS service module (already exists)
│   ├── k8s-deployment/      — reusable K8s deployment module (already exists)
│   └── <name>-service/      — NEW: this service's specific resources
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       └── README.md
├── environments/
│   ├── staging/
│   │   ├── main.tf          — instantiates modules for staging
│   │   ├── terraform.tfvars — staging-specific values (no secrets)
│   │   └── backend.tf       — remote state config
│   └── production/
│       ├── main.tf
│       ├── terraform.tfvars
│       └── backend.tf
└── shared/
    ├── vpc.tf
    └── rds-cluster.tf
```

## Steps

### 1. Create the module directory

```bash
mkdir -p terraform/modules/<name>-service
```

### 2. Write variables.tf — the module's inputs

Every value that differs between environments is a variable. No hardcoded environment names, ARNs, or instance sizes:

```hcl
# terraform/modules/<name>-service/variables.tf

variable "environment" {
  description = "Deployment environment (staging, production)"
  type        = string
}

variable "service_name" {
  description = "Name of the service (used in resource names and tags)"
  type        = string
  default     = "<name>-service"
}

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
}

variable "desired_count" {
  description = "Number of running instances"
  type        = number
  default     = 2
}

variable "cpu" {
  description = "CPU units (256 = 0.25 vCPU)"
  type        = number
  default     = 256
}

variable "memory" {
  description = "Memory in MiB"
  type        = number
  default     = 512
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

# Network
variable "vpc_id"              { type = string }
variable "private_subnet_ids"  { type = list(string) }
variable "ecs_cluster_id"      { type = string }

# Secrets — passed from secrets manager, not hardcoded
variable "db_password_secret_arn" {
  description = "ARN of the AWS Secrets Manager secret containing the DB password"
  type        = string
  sensitive   = true
}
```

### 3. Write main.tf — the module's resources

#### ECS pattern (simpler, good for most services):

```hcl
# terraform/modules/<name>-service/main.tf

locals {
  full_name = "${var.service_name}-${var.environment}"
  tags = {
    Service     = var.service_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# --- IAM Role ---
resource "aws_iam_role" "<name>_task_role" {
  name = "${local.full_name}-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = local.tags
}

# Grant access only to this service's secrets (least privilege)
resource "aws_iam_role_policy" "<name>_secrets_policy" {
  name = "${local.full_name}-secrets"
  role = aws_iam_role.<name>_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [var.db_password_secret_arn]
    }]
  })
}

# --- RDS Database (one per service — service owns its data) ---
resource "aws_db_instance" "<name>" {
  identifier     = local.full_name
  engine         = "postgres"
  engine_version = "15"
  instance_class = var.db_instance_class
  db_name        = replace(var.service_name, "-", "_")
  username       = "app"
  password       = data.aws_secretsmanager_secret_version.db_password.secret_string

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_encrypted     = true

  vpc_security_group_ids = [aws_security_group.<name>_db.id]
  db_subnet_group_name   = aws_db_subnet_group.<name>.name

  backup_retention_period = var.environment == "production" ? 7 : 1
  deletion_protection     = var.environment == "production"
  skip_final_snapshot     = var.environment != "production"

  tags = local.tags
}

data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = var.db_password_secret_arn
}

# --- ECS Task Definition ---
resource "aws_ecs_task_definition" "<name>" {
  family                   = local.full_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.<name>_task_role.arn
  task_role_arn            = aws_iam_role.<name>_task_role.arn

  container_definitions = jsonencode([{
    name      = var.service_name
    image     = "${aws_ecr_repository.<name>.repository_url}:${var.image_tag}"
    essential = true

    portMappings = [{ containerPort = 3000, protocol = "tcp" }]

    environment = [
      { name = "SERVICE_NAME",  value = var.service_name },
      { name = "SERVICE_VERSION", value = var.image_tag },
      { name = "NODE_ENV",      value = "production" },
      { name = "LOG_LEVEL",     value = "info" },
      { name = "OTEL_EXPORTER_OTLP_ENDPOINT", value = "http://otel-collector:4318" },
    ]

    secrets = [{
      name      = "DATABASE_URL"
      valueFrom = var.db_password_secret_arn
    }]

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/health/live || exit 1"]
      interval    = 15
      timeout     = 3
      retries     = 3
      startPeriod = 30
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/${local.full_name}"
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])

  tags = local.tags
}

# --- ECS Service ---
resource "aws_ecs_service" "<name>" {
  name            = local.full_name
  cluster         = var.ecs_cluster_id
  task_definition = aws_ecs_task_definition.<name>.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # Zero-downtime rolling deployment
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.<name>_svc.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.<name>.arn
    container_name   = var.service_name
    container_port   = 3000
  }

  # Wait for deployment to stabilize before reporting success
  wait_for_steady_state = true

  tags = local.tags
}

# --- ECR Repository ---
resource "aws_ecr_repository" "<name>" {
  name                 = local.full_name
  image_tag_mutability = "IMMUTABLE"   # immutable tags: no silent overwrites

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

data "aws_region" "current" {}
```

### 4. Write outputs.tf

```hcl
# terraform/modules/<name>-service/outputs.tf

output "service_arn" {
  description = "ARN of the ECS service"
  value       = aws_ecs_service.<name>.id
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing Docker images"
  value       = aws_ecr_repository.<name>.repository_url
}

output "db_endpoint" {
  description = "RDS endpoint (for internal connection string)"
  value       = aws_db_instance.<name>.endpoint
  sensitive   = true
}
```

### 5. Instantiate in the environment

```hcl
# terraform/environments/staging/main.tf

module "<name>_service" {
  source = "../../modules/<name>-service"

  environment    = "staging"
  image_tag      = var.<name>_image_tag   # set in CI/CD pipeline
  desired_count  = 1                       # 1 instance in staging is fine

  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  ecs_cluster_id     = module.ecs_cluster.id

  db_instance_class      = "db.t3.micro"
  db_password_secret_arn = aws_secretsmanager_secret.<name>_db_staging.arn
}
```

```hcl
# terraform/environments/production/main.tf

module "<name>_service" {
  source = "../../modules/<name>-service"

  environment    = "production"
  image_tag      = var.<name>_image_tag
  desired_count  = 2   # minimum 2 for HA

  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  ecs_cluster_id     = module.ecs_cluster.id

  db_instance_class      = "db.t3.small"   # size up for production
  db_password_secret_arn = aws_secretsmanager_secret.<name>_db_prod.arn
}
```

### 6. Provision the DB password secret (once, before first apply)

```bash
# Create the secret in AWS Secrets Manager before terraform apply
aws secretsmanager create-secret \
  --name "/<name>-service/staging/db-password" \
  --secret-string "$(openssl rand -base64 32)" \
  --region us-east-1

# Store the ARN — you'll need it in terraform.tfvars
aws secretsmanager describe-secret \
  --secret-id "/<name>-service/staging/db-password" \
  --query "ARN" --output text
```

**Never put the secret value in `terraform.tfvars` or any file committed to git.** Only store the ARN.

### 7. Apply and verify

```bash
cd terraform/environments/staging

terraform init
terraform plan -var="<name>_image_tag=v1.0.0"
terraform apply -var="<name>_image_tag=v1.0.0"

# Verify service is healthy
aws ecs describe-services \
  --cluster <cluster-name> \
  --services <name>-service-staging \
  --query "services[0].{status:status,running:runningCount,desired:desiredCount}"
```

## Checklist

- [ ] Module in `terraform/modules/<name>-service/` with `variables.tf`, `main.tf`, `outputs.tf`
- [ ] Every environment-specific value is a variable (no hardcoded instance sizes, counts, or regions)
- [ ] IAM role uses least-privilege — only `secretsmanager:GetSecretValue` for this service's secrets
- [ ] DB password from AWS Secrets Manager ARN — never in `.tfvars` or git
- [ ] ECR repo uses immutable tags (`image_tag_mutability = "IMMUTABLE"`)
- [ ] ECS service uses rolling deployment (`min_healthy = 50%, max = 200%`)
- [ ] `wait_for_steady_state = true` — Terraform fails if deployment doesn't stabilize
- [ ] Backup retention ≥ 7 days in production, deletion protection enabled
- [ ] Health check configured in task definition (same endpoint as `/health/live`)
- [ ] Logs go to CloudWatch (`awslogs` driver) — not just stdout that disappears on container exit
- [ ] `terraform plan` reviewed before `terraform apply`
- [ ] Staging and production use same module, different `terraform.tfvars`

## Files involved

| File | Action |
|------|--------|
| `terraform/modules/<name>-service/variables.tf` | Create: module inputs |
| `terraform/modules/<name>-service/main.tf` | Create: IAM, RDS, ECS task + service, ECR |
| `terraform/modules/<name>-service/outputs.tf` | Create: ECR URL, service ARN, DB endpoint |
| `terraform/environments/staging/main.tf` | Update: add module instantiation |
| `terraform/environments/production/main.tf` | Update: add module instantiation |

## Common mistakes

**Secrets in tfvars** — `db_password = "MyPassword123"` in `terraform.tfvars` is a secret in your git history forever. Provision secrets through AWS Secrets Manager before the first `terraform apply`; reference only the ARN in Terraform.

**Mutable image tags** — `image_tag_mutability = "MUTABLE"` means `v1.0.0` can be silently overwritten with new code. Use immutable tags so you always know exactly which code is deployed.

**No deletion protection in production** — a misconfigured `terraform destroy` or a `plan` that recreates the RDS instance will drop your production database. `deletion_protection = true` prevents accidental deletion.

**staging uses different module than production** — copy-pasting the ECS resources directly into the staging config (instead of using the shared module) means staging drifts from production. Always use the same module with different variables.

**No `wait_for_steady_state`** — without this, `terraform apply` reports success when ECS accepts the task definition update, not when the new containers are actually healthy and traffic is flowing to them. A failing deployment looks like a success.
