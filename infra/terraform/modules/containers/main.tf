# ═══════════════════════════════════════════════════════════
# Containers Module — ECS Fargate
#
# Cloud equivalent of mcp-server and rag-worker containers.
# Runs on Fargate (serverless) — no EC2 instances to manage.
#
# ECR repositories store the Docker images.
# Task definitions pull from ECR and inject secrets.
# ═══════════════════════════════════════════════════════════

variable "project_name" { type = string }
variable "environment" { type = string }
variable "aws_region" { type = string }

variable "private_subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "secret_arn" {
  type        = string
  description = "ARN of the Secrets Manager secret containing API keys"
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "redis_url" {
  type = string
}

variable "embedding_model" {
  type    = string
  default = "voyage/voyage-3"
}

variable "embedding_dimensions" {
  type    = number
  default = 1024
}

variable "mcp_server_cpu" {
  type    = number
  default = 256
  description = "CPU units for mcp-server (256 = 0.25 vCPU)"
}

variable "mcp_server_memory" {
  type    = number
  default = 512
  description = "Memory in MB for mcp-server"
}

variable "rag_worker_cpu" {
  type    = number
  default = 512
  description = "CPU units for rag-worker (512 = 0.5 vCPU)"
}

variable "rag_worker_memory" {
  type    = number
  default = 1024
  description = "Memory in MB for rag-worker"
}

# ── ECR Repositories ─────────────────────────────────────

resource "aws_ecr_repository" "mcp_server" {
  name                 = "${var.project_name}-mcp-server"
  image_tag_mutability = "MUTABLE"
  force_delete         = var.environment == "dev"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_ecr_repository" "rag_worker" {
  name                 = "${var.project_name}-rag-worker"
  image_tag_mutability = "MUTABLE"
  force_delete         = var.environment == "dev"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# ── ECS Cluster ──────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-${var.environment}"

  setting {
    name  = "containerInsights"
    value = var.environment == "prod" ? "enabled" : "disabled"
  }

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# ── IAM: Task Execution Role ─────────────────────────────

resource "aws_iam_role" "ecs_execution" {
  name = "${var.project_name}-${var.environment}-ecs-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "secrets_access" {
  name = "secrets-access"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [var.secret_arn]
    }]
  })
}

# ── IAM: Task Role ───────────────────────────────────────

resource "aws_iam_role" "ecs_task" {
  name = "${var.project_name}-${var.environment}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# ── CloudWatch Log Groups ────────────────────────────────

resource "aws_cloudwatch_log_group" "mcp_server" {
  name              = "/ecs/${var.project_name}/${var.environment}/mcp-server"
  retention_in_days = var.environment == "prod" ? 30 : 7

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_cloudwatch_log_group" "rag_worker" {
  name              = "/ecs/${var.project_name}/${var.environment}/rag-worker"
  retention_in_days = var.environment == "prod" ? 30 : 7

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# ── Task Definitions ─────────────────────────────────────

resource "aws_ecs_task_definition" "mcp_server" {
  family                   = "${var.project_name}-${var.environment}-mcp-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.mcp_server_cpu
  memory                   = var.mcp_server_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "mcp-server"
    image     = "${aws_ecr_repository.mcp_server.repository_url}:latest"
    essential = true

    portMappings = [{
      containerPort = 3100
      protocol      = "tcp"
    }]

    environment = [
      { name = "PORT", value = "3100" },
      { name = "EMBEDDING_MODEL", value = var.embedding_model },
      { name = "EMBEDDING_DIMENSIONS", value = tostring(var.embedding_dimensions) },
      { name = "REDIS_URL", value = var.redis_url },
      { name = "OTEL_SERVICE_NAME", value = "mcp-server" },
    ]

    secrets = [
      { name = "ANTHROPIC_API_KEY", valueFrom = "${var.secret_arn}:ANTHROPIC_API_KEY::" },
      { name = "OPENROUTER_API_KEY", valueFrom = "${var.secret_arn}:OPENROUTER_API_KEY::" },
      { name = "SUPABASE_SERVICE_KEY", valueFrom = "${var.secret_arn}:POSTGRES_PASSWORD::" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.mcp_server.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "mcp-server"
      }
    }
  }])

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_ecs_task_definition" "rag_worker" {
  family                   = "${var.project_name}-${var.environment}-rag-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.rag_worker_cpu
  memory                   = var.rag_worker_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "rag-worker"
    image     = "${aws_ecr_repository.rag_worker.repository_url}:latest"
    essential = true

    environment = [
      { name = "EMBEDDING_MODEL", value = var.embedding_model },
      { name = "EMBEDDING_DIMENSIONS", value = tostring(var.embedding_dimensions) },
      { name = "REDIS_URL", value = var.redis_url },
      { name = "OTEL_SERVICE_NAME", value = "rag-worker" },
    ]

    secrets = [
      { name = "ANTHROPIC_API_KEY", valueFrom = "${var.secret_arn}:ANTHROPIC_API_KEY::" },
      { name = "OPENROUTER_API_KEY", valueFrom = "${var.secret_arn}:OPENROUTER_API_KEY::" },
      { name = "SUPABASE_SERVICE_KEY", valueFrom = "${var.secret_arn}:POSTGRES_PASSWORD::" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.rag_worker.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "rag-worker"
      }
    }
  }])

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# ── ECS Services ─────────────────────────────────────────

resource "aws_ecs_service" "mcp_server" {
  name            = "mcp-server"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.mcp_server.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.security_group_id]
  }

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_ecs_service" "rag_worker" {
  name            = "rag-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.rag_worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.security_group_id]
  }

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# ── Outputs ──────────────────────────────────────────────

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "mcp_server_ecr_url" {
  value = aws_ecr_repository.mcp_server.repository_url
}

output "rag_worker_ecr_url" {
  value = aws_ecr_repository.rag_worker.repository_url
}
