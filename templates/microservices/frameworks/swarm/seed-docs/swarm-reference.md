# Docker Swarm — Orchestration Reference

## Why Swarm

Docker Swarm is the simplest container orchestrator. If your team already knows Docker Compose, Swarm is a natural step up — the syntax is nearly identical. Swarm is built into Docker Engine (no extra installation), supports rolling updates, service discovery, load balancing, and secrets management out of the box.

**Choose Swarm when:**
- Your team is small (< 10 engineers) and already uses Docker Compose
- You have < 20 services and < 50 instances
- You want operational simplicity over advanced scheduling features
- You don't need auto-scaling per service (Swarm scales manually or via external tools)

**Choose Kubernetes when:**
- You need auto-scaling (HPA, VPA, cluster autoscaler)
- You have complex scheduling requirements (GPU nodes, affinity, taints)
- Your organization standardizes on K8s (EKS, GKE, AKS)
- You need a service mesh (Istio, Linkerd)

## Swarm Architecture

```
Manager Nodes (3 for HA)
├── Raft consensus for cluster state
├── Service scheduling decisions
└── Ingress routing mesh

Worker Nodes (N)
├── Run service tasks (containers)
├── Report health to managers
└── No scheduling decisions
```

Minimum production setup: 3 manager nodes (Raft needs a majority quorum) + N worker nodes.

## Docker Stack File

A Swarm stack file is a docker-compose.yml with `deploy` sections:

```yaml
version: "3.8"

services:
  user-api:
    image: ${REGISTRY}/user-api:${TAG:-latest}
    deploy:
      replicas: 3
      update_config:
        parallelism: 1          # update one at a time
        delay: 10s              # wait between updates
        failure_action: rollback
        order: start-first      # start new before stopping old
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
      resources:
        limits:
          cpus: "0.5"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 256M
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health/ready"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s
    networks:
      - internal
    secrets:
      - db_url
      - api_key

  billing-api:
    image: ${REGISTRY}/billing-api:${TAG:-latest}
    deploy:
      replicas: 2
      # ... same pattern
    networks:
      - internal

networks:
  internal:
    driver: overlay
    attachable: true

secrets:
  db_url:
    external: true
  api_key:
    external: true
```

## Key Swarm Concepts

### Services vs Tasks

A **service** is the desired state (run 3 replicas of user-api). A **task** is one running container. Swarm ensures the actual state matches the desired state.

### Overlay Networks

Overlay networks span multiple nodes. Services on the same overlay network can reach each other by service name (DNS-based service discovery). External traffic hits the **ingress routing mesh** which load-balances across all instances.

### Secrets

```bash
# Create a secret
echo "postgresql://user:pass@host/db" | docker secret create db_url -

# Reference in stack file
secrets:
  - db_url
# Available inside the container at /run/secrets/db_url
```

### Rolling Updates

```bash
# Deploy/update a stack
docker stack deploy -c docker-stack.yml myapp

# Scale a service
docker service scale myapp_user-api=5

# Rollback
docker service rollback myapp_user-api
```

## Terraform for Swarm

Swarm nodes are EC2 instances (or equivalent). Terraform provisions them, installs Docker, and initializes the Swarm:

```hcl
resource "aws_instance" "swarm_manager" {
  count         = 3
  ami           = var.docker_ami
  instance_type = "t3.medium"
  subnet_id     = var.private_subnet_ids[count.index % length(var.private_subnet_ids)]

  user_data = count.index == 0 ? <<-EOF
    #!/bin/bash
    docker swarm init --advertise-addr $(hostname -I | awk '{print $1}')
    docker swarm join-token worker -q > /tmp/worker-token
  EOF : <<-EOF
    #!/bin/bash
    docker swarm join --token ${var.manager_token} ${var.first_manager_ip}:2377
  EOF
}
```
