# Infrastructure as Code — Terraform for Microservices

## Principles

Infrastructure as Code means your cloud resources are defined in version-controlled files, reviewed in PRs, and applied reproducibly. No clicking in consoles, no manual SSH, no snowflake servers.

### Environment Parity

Dev, staging, and production use the SAME Terraform modules with DIFFERENT variable values. The only differences between environments are sizing (instance classes, replica counts) and access controls. The architecture is identical.

```
infra/terraform/
├── modules/                 ← shared, environment-agnostic
│   ├── networking/          ← VPC, subnets, security groups
│   ├── database/            ← RDS per service
│   ├── cache/               ← ElastiCache
│   ├── containers/          ← ECS/EKS task definitions + services
│   ├── messaging/           ← SQS/SNS or RabbitMQ
│   ├── secrets/             ← Secrets Manager
│   └── monitoring/          ← CloudWatch, dashboards, alarms
└── environments/
    ├── dev/
    │   ├── main.tf          ← imports modules, sets dev variables
    │   └── terraform.tfvars ← db.t4g.micro, 1 replica, etc.
    ├── staging/
    │   ├── main.tf
    │   └── terraform.tfvars ← db.t4g.medium, 2 replicas
    └── prod/
        ├── main.tf
        └── terraform.tfvars ← db.r6g.large, 3 replicas, multi-AZ
```

### Module Design

Each module manages one infrastructure concern. Modules accept variables for sizing and output the values other modules need (endpoint URLs, security group IDs, ARNs).

```hcl
# modules/database/main.tf
variable "service_name"     {}
variable "instance_class"   { default = "db.t4g.micro" }
variable "subnet_ids"       { type = list(string) }
variable "security_group_id" {}

resource "aws_db_instance" "main" {
  identifier     = var.service_name
  instance_class = var.instance_class
  # ...
}

output "endpoint" { value = aws_db_instance.main.endpoint }
output "database_url" {
  value     = "postgresql://postgres:${var.password}@${aws_db_instance.main.endpoint}/${var.service_name}"
  sensitive = true
}
```

### State Management

Remote state is mandatory for teams. Use S3 + DynamoDB locking:

```hcl
terraform {
  backend "s3" {
    bucket         = "mycompany-terraform-state"
    key            = "microservices/prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}
```

Each environment has its own state file. Never share state across environments.

### Secrets

Never put secrets in Terraform variables files or state. Use AWS Secrets Manager (or Vault) and reference secrets by ARN in task definitions:

```hcl
resource "aws_ecs_task_definition" "api" {
  container_definitions = jsonencode([{
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.db_url.arn },
      { name = "API_KEY",      valueFrom = aws_secretsmanager_secret.api_key.arn },
    ]
  }])
}
```

## Per-Service Infrastructure

Each microservice gets:
- Its own database (RDS instance or Aurora cluster)
- Its own ECS service or K8s deployment
- Its own ECR repository (container registry)
- Its own CloudWatch log group
- Its own IAM role (principle of least privilege)

Services share:
- VPC and subnets
- Load balancer (with path-based or host-based routing)
- Message broker (SQS/SNS or RabbitMQ)
- Secrets Manager
- Monitoring infrastructure
