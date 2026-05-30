# Azure AKS — Provider-Specific Reference

## AKS Architecture

AKS provides a managed Kubernetes control plane (free tier available). Azure manages the API server, etcd, and scheduler. You manage node pools. AKS integrates deeply with Azure Active Directory for RBAC and identity.

### Node Options

**System node pools:** run cluster system pods (CoreDNS, metrics-server). At least one required.

**User node pools:** run your application pods. Define instance types, sizes, and auto-scaling per pool. Use separate pools for different workload profiles (CPU-optimized, memory-optimized, GPU).

**Virtual Nodes (ACI):** serverless pods via Azure Container Instances. Burst capacity without pre-provisioned nodes. Good for batch jobs and spiky workloads.

### Terraform for AKS

```hcl
resource "azurerm_kubernetes_cluster" "main" {
  name                = "${var.project}-${var.environment}"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  dns_prefix          = var.project

  default_node_pool {
    name                = "default"
    vm_size             = "Standard_D2s_v3"
    enable_auto_scaling = true
    min_count           = 2
    max_count           = 10
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin = "azure"   # Azure CNI for direct pod networking
  }
}
```

### Azure-Specific Integrations

**Azure AD Pod Identity / Workload Identity:** assign Azure AD identities to pods. Each service accesses only the Azure resources it needs (Key Vault, Storage, Service Bus) without shared credentials.

**Key Vault Provider for Secrets Store CSI Driver:** mount Azure Key Vault secrets directly into pods.

**Azure Application Gateway Ingress Controller (AGIC):** maps Kubernetes Ingress to Azure Application Gateway. L7 load balancing, WAF, TLS termination.

**Azure Monitor for Containers:** metrics, logs, and health monitoring built into AKS. Prometheus integration available via Azure Managed Prometheus.

**Azure Service Bus:** managed message broker. Use for async inter-service communication (queues and topics).
