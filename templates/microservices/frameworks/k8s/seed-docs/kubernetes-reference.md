# Kubernetes — Orchestration Reference

## Core Concepts

### Pod
The smallest deployable unit. One or more containers that share networking and storage. In practice, most pods run a single container. Pods are ephemeral — they're created and destroyed, never patched in place.

### Deployment
Manages a set of identical pods. Defines the desired state (3 replicas of user-api:v2.1), and the controller ensures reality matches. Rolling updates replace pods one at a time.

### Service
A stable network endpoint for a set of pods. Pods come and go; the Service DNS name (`user-api.default.svc.cluster.local`) stays constant. Types: ClusterIP (internal), NodePort (expose on each node), LoadBalancer (cloud LB).

### ConfigMap and Secret
ConfigMaps hold non-sensitive configuration (env vars, config files). Secrets hold sensitive data (passwords, tokens, TLS certs). Both are injected into pods as env vars or mounted files.

### Namespace
Logical isolation within a cluster. Use namespaces for environments (dev, staging, prod) or for team boundaries.

## Manifest Structure with Kustomize

Kustomize layers base manifests with environment-specific overlays — no templating, no Helm charts, just patches:

```
k8s/
├── base/
│   ├── kustomization.yaml
│   ├── namespace.yaml
│   ├── user-api/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── hpa.yaml              ← auto-scaling
│   ├── billing-api/
│   │   └── ...
│   └── shared/
│       ├── configmap.yaml
│       └── network-policy.yaml
└── overlays/
    ├── dev/
    │   ├── kustomization.yaml    ← patches: 1 replica, small resources
    │   └── configmap-patch.yaml
    ├── staging/
    │   ├── kustomization.yaml    ← patches: 2 replicas, medium resources
    │   └── configmap-patch.yaml
    └── prod/
        ├── kustomization.yaml    ← patches: 3 replicas, large resources, PDB
        ├── configmap-patch.yaml
        └── pdb.yaml              ← PodDisruptionBudget
```

```yaml
# base/kustomization.yaml
resources:
  - namespace.yaml
  - user-api/deployment.yaml
  - user-api/service.yaml
  - user-api/hpa.yaml
  - billing-api/deployment.yaml
  - billing-api/service.yaml

# overlays/prod/kustomization.yaml
bases:
  - ../../base
patchesStrategicMerge:
  - configmap-patch.yaml
  - pdb.yaml
```

## Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: user-api
  labels:
    app: user-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: user-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0           # zero-downtime: new pod starts before old stops
  template:
    metadata:
      labels:
        app: user-api
    spec:
      containers:
        - name: user-api
          image: REGISTRY/user-api:TAG
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: user-api-secrets
                  key: database-url
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
```

## Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: user-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: user-api
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## Service Mesh (Optional)

For complex microservice topologies, a service mesh (Istio, Linkerd) provides:
- Mutual TLS between services (zero-trust networking)
- Traffic management (canary deployments, traffic splitting)
- Observability (automatic metrics, traces, access logs per service)
- Retries and circuit breaking at the mesh level (not in application code)

Only add a service mesh when you have 10+ services and need these features. For smaller systems, application-level retries and circuit breakers are simpler.

## Kubernetes Best Practices for Microservices

1. **One service per namespace** or one environment per namespace — not all services in `default`
2. **Resource requests AND limits** on every container — prevents noisy neighbors
3. **PodDisruptionBudgets** in production — prevent voluntary disruptions from killing all replicas
4. **Network policies** — restrict which services can talk to which (principle of least access)
5. **Readiness probes gate traffic** — a pod doesn't receive requests until it's ready
6. **Liveness probes trigger restarts** — if the probe fails, K8s kills and restarts the pod
7. **External secrets operator** — sync secrets from AWS Secrets Manager / Vault into K8s secrets
8. **GitOps** (ArgoCD or Flux) — cluster state matches what's in Git, automatically reconciled
