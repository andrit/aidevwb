# AWS EKS — Provider-Specific Reference

## EKS Architecture

EKS runs the Kubernetes control plane as a managed service. You manage the worker nodes (EC2 instances or Fargate). AWS handles etcd, API server, scheduler, and controller manager.

### Node Options

**Managed Node Groups (recommended):** AWS manages the EC2 instances. Auto-scaling, automated AMI updates, graceful draining during updates. You pick instance type and count.

**Fargate:** serverless — no EC2 instances to manage. Each pod gets its own isolated compute. Best for batch jobs and services with variable load. More expensive per-pod but zero node management.

**Self-managed nodes:** you manage the EC2 instances and join them to the cluster. Maximum control, maximum ops burden. Rarely needed.

### Terraform for EKS

```hcl
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "${var.project}-${var.environment}"
  cluster_version = "1.30"
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnets

  eks_managed_node_groups = {
    default = {
      instance_types = ["t3.medium"]
      min_size       = 2
      max_size       = 10
      desired_size   = 3
    }
  }

  # Enable IRSA (IAM Roles for Service Accounts)
  enable_irsa = true
}
```

### AWS-Specific Integrations

**ALB Ingress Controller:** maps Kubernetes Ingress resources to AWS ALBs. Path-based routing, TLS termination, WAF integration.

**IRSA (IAM Roles for Service Accounts):** assign IAM roles to Kubernetes service accounts. Each service gets least-privilege access to AWS resources (S3, SQS, Secrets Manager) without sharing node-level permissions.

**EBS CSI Driver:** persistent volumes backed by EBS. Required for stateful services (databases running in K8s, though managed RDS is usually better).

**AWS Secrets Manager CSI Driver:** mount AWS secrets directly into pods as files.

**Container Insights:** CloudWatch metrics and logs from EKS. Automatic if you enable the CloudWatch agent add-on.
