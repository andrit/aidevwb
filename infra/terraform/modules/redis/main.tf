# ═══════════════════════════════════════════════════════════
# Redis Module — ElastiCache Redis 7
#
# Cloud equivalent of the local redis container.
# Used for BullMQ job queuing and caching.
# ═══════════════════════════════════════════════════════════

variable "project_name" { type = string }
variable "environment" { type = string }

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the cache subnet group"
}

variable "security_group_id" {
  type        = string
  description = "Security group allowing Redis access"
}

variable "node_type" {
  type        = string
  default     = "cache.t4g.micro"
  description = "ElastiCache node type. t4g.micro for dev, r6g.large+ for prod."
}

variable "num_cache_nodes" {
  type        = number
  default     = 1
  description = "Number of cache nodes. 1 for dev, 2+ for prod."
}

# ── Subnet Group ─────────────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-redis-subnet"
  subnet_ids = var.private_subnet_ids

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# ── Redis Cluster ────────────────────────────────────────

resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${var.project_name}-${var.environment}"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.node_type
  num_cache_nodes      = var.num_cache_nodes
  parameter_group_name = "default.redis7"

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [var.security_group_id]

  port = 6379

  tags = {
    Name        = "${var.project_name}-${var.environment}-redis"
    Project     = var.project_name
    Environment = var.environment
  }
}

# ── Outputs ──────────────────────────────────────────────

output "endpoint" {
  value = aws_elasticache_cluster.main.cache_nodes[0].address
}

output "port" {
  value = aws_elasticache_cluster.main.cache_nodes[0].port
}

output "redis_url" {
  value = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:${aws_elasticache_cluster.main.cache_nodes[0].port}"
}
