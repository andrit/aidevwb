# Google GKE — Provider-Specific Reference

## GKE Architecture

GKE runs the most tightly integrated managed Kubernetes. The control plane is free (no management fee). Google manages upgrades, patching, and etcd. GKE Autopilot mode goes further — Google manages the nodes too.

### Node Options

**Autopilot (recommended for most teams):** fully managed. You define pods, GKE provisions the right nodes automatically. Per-pod billing. No node management, no capacity planning. Enforces best practices (resource requests required, no privileged containers).

**Standard:** you manage node pools (instance types, sizes, auto-scaling). More control, more responsibility. Choose this when you need GPUs, specific machine types, or custom node configurations.

### Terraform for GKE

```hcl
resource "google_container_cluster" "main" {
  name     = "${var.project}-${var.environment}"
  location = var.region

  # Autopilot mode
  enable_autopilot = true

  # Or Standard mode with node pools:
  # remove_default_node_pool = true
  # initial_node_count       = 1
}

# Standard mode node pool (only if not using Autopilot)
resource "google_container_node_pool" "default" {
  cluster    = google_container_cluster.main.name
  node_count = 3

  node_config {
    machine_type = "e2-medium"
    oauth_scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  autoscaling {
    min_node_count = 2
    max_node_count = 10
  }
}
```

### GCP-Specific Integrations

**Workload Identity:** maps Kubernetes service accounts to Google Cloud service accounts. Like AWS IRSA but for GCP. Each service accesses only the GCP resources it needs.

**Cloud SQL Auth Proxy:** secure connection to Cloud SQL (managed Postgres/MySQL) from pods without exposing database credentials. Runs as a sidecar container.

**GKE Ingress:** maps to Google Cloud Load Balancer. Supports global load balancing, Cloud CDN, Cloud Armor (WAF).

**Config Connector:** manage GCP resources (Cloud SQL, Pub/Sub, Storage) using Kubernetes manifests. Infrastructure as Kubernetes objects.
