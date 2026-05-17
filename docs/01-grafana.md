# Grafana — Dashboards & Visualization

## What Grafana Is

Grafana is an open-source observability platform that turns raw telemetry data (traces, metrics, logs) into visual dashboards you can query, alert on, and share. In the workbench, Grafana is the **single pane of glass** for understanding what your services are doing — how long requests take, where errors occur, and how data flows through the system.

Grafana doesn't collect or store data itself. It connects to **datasources** (like Tempo for traces, Prometheus for metrics, Loki for logs) and queries them on demand. Think of it as a universal visualization layer that speaks every observability protocol.

## Why Grafana and Not Something Else

Alternatives exist — Kibana (Elastic), Datadog, New Relic — but Grafana is:
- **Vendor-neutral**: works with any backend (Tempo, Jaeger, Zipkin, Prometheus, InfluxDB, etc.)
- **Self-hostable**: no SaaS dependency, no data leaving your machine
- **Free and open-source**: the OSS version covers everything the workbench needs
- **Lightweight**: a single container, ~50MB memory idle

In the workbench, Grafana serves two purposes:
1. **Observe the workbench itself** — trace MCP server requests, RAG ingestion pipelines, database query performance
2. **Observe whatever you build** — any project running in the workbench can emit traces to the same Grafana instance

## Architecture in the Workbench

```
Your Services                 Collection              Storage            Visualization
─────────────                 ──────────              ───────            ─────────────
┌──────────────┐
│  mcp-server  │──── OTLP ───▸┌─────────────────┐    ┌───────┐        ┌─────────┐
│  (TS/Fastify)│              │ otel-collector   │───▸│ tempo │◂───────│ grafana │
└──────────────┘              │ (:4318 HTTP)     │    │       │        │ (:3200) │
┌──────────────┐              └─────────────────┘    └───────┘        └─────────┘
│  rag-worker  │──── OTLP ───▸        ▲
│  (Python)    │                      │
└──────────────┘                      │
┌──────────────┐                      │
│ your project │──── OTLP ────────────┘
└──────────────┘
```

The data flow:
1. Services emit **traces** using the OpenTelemetry SDK (OTLP protocol)
2. The **OTel Collector** receives traces on port `4318` (HTTP) and batches them
3. The collector forwards batched traces to **Tempo** for storage
4. **Grafana** queries Tempo when you open a dashboard or run a search

## Configuration Files

### Datasource Provisioning

**File:** `configs/grafana/datasources.yml`

This file auto-configures Grafana's datasources on startup. You never need to manually add Tempo in the Grafana UI — it's there from the first boot.

```yaml
apiVersion: 1

datasources:
  - name: Tempo            # Display name in Grafana
    type: tempo            # Datasource plugin type
    access: proxy          # Grafana backend proxies requests to Tempo
    url: http://tempo:3200 # Tempo's internal address on Docker network
    isDefault: true        # Default datasource for new panels
    editable: true         # Allow editing in the UI
    jsonData:
      httpMethod: GET
      tracesToLogs:
        datasourceUid: ""  # Link traces to logs (empty = disabled)
      serviceMap:
        datasourceUid: ""  # Service topology map (empty = disabled)
```

Key fields:
- `access: proxy` — Grafana's backend makes the request to Tempo, not your browser. This is required because `tempo:3200` is a Docker-internal hostname your browser can't resolve.
- `url: http://tempo:3200` — uses the Docker network DNS name, not `localhost`

### Docker Compose Entry

**File:** `docker-compose.yml` (grafana service)

```yaml
grafana:
  image: grafana/grafana:10.4.2
  container_name: grafana
  ports:
    - "3200:3000"          # Host :3200 → Container :3000
  environment:
    GF_SECURITY_ADMIN_USER: admin
    GF_SECURITY_ADMIN_PASSWORD: admin
    GF_AUTH_ANONYMOUS_ENABLED: "true"        # No login required for local dev
    GF_AUTH_ANONYMOUS_ORG_ROLE: Admin        # Anonymous users get full access
  volumes:
    - ./configs/grafana/datasources.yml:/etc/grafana/provisioning/datasources/datasources.yml:ro
    - grafana-data:/var/lib/grafana          # Persists dashboards across restarts
```

Key design choices:
- **Anonymous admin access** — this is a local dev tool, not production. Removing the login barrier reduces friction.
- **Port 3200** — avoids conflicting with the default Grafana port (3000) which Supabase Studio also uses.
- **Provisioning volume mount** — the datasources file is mounted into Grafana's provisioning directory. Grafana reads this on startup and auto-creates the datasource.

## Interfaces

### Web UI (Primary)

**URL:** `http://localhost:3200`
**Login:** `admin` / `admin` (or no login if anonymous access is enabled)

Key pages:
- **Explore** → Select "Tempo" datasource → Search for traces by service name, duration, status
- **Dashboards** → Create or import dashboards. Saved in the `grafana-data` volume.
- **Alerting** → Set up alert rules (e.g., notify when p99 latency exceeds 2s)
- **Connections > Data sources** → View and edit datasource configurations

### HTTP API

Grafana exposes a full REST API for automation:

```bash
# List datasources
curl -s http://localhost:3200/api/datasources -u admin:admin

# Health check
curl -s http://localhost:3200/api/health

# Search dashboards
curl -s http://localhost:3200/api/search -u admin:admin

# Create a dashboard (JSON model)
curl -X POST http://localhost:3200/api/dashboards/db \
  -u admin:admin \
  -H "Content-Type: application/json" \
  -d '{"dashboard": {"title": "My Dashboard", "panels": []}, "overwrite": false}'
```

### Provisioning System

Beyond datasources, you can auto-provision dashboards and alert rules by adding files to the provisioning directories:

```
/etc/grafana/provisioning/
├── datasources/     ← datasources.yml (we use this)
├── dashboards/      ← dashboard provider configs
├── alerting/        ← alert rule configs
└── plugins/         ← plugin install configs
```

To auto-provision a dashboard, you'd add a provider config and a JSON dashboard file. We don't ship pre-built dashboards because they depend on what services you're tracing, but the infrastructure is ready.

## Adding Datasources

### Adding Prometheus (for metrics)

If you add Prometheus to the stack later, add it to `datasources.yml`:

```yaml
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: false
    editable: true
```

### Adding Loki (for logs)

```yaml
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: false
    editable: true
    jsonData:
      derivedFields:
        - datasourceUid: tempo
          matcherRegex: "traceID=(\\w+)"
          name: TraceID
          url: "$${__value.raw}"
```

The `derivedFields` config lets you click a trace ID in a log line and jump directly to the trace in Tempo.

## Walkthrough: Exploring Traces

### Step 1 — Open Grafana

Navigate to [http://localhost:3200](http://localhost:3200). Click "Explore" in the left sidebar.

### Step 2 — Select Tempo

In the datasource dropdown at the top, select **Tempo**.

### Step 3 — Search by Service

Switch to the **Search** tab. In the "Service Name" dropdown, you'll see services that have emitted traces (e.g., `mcp-server`, `rag-worker`). Select one.

### Step 4 — Filter by Operation

Optionally filter by operation name (e.g., `POST /ingest`, `POST /query`). Set a time range in the top-right.

### Step 5 — View a Trace

Click on a trace in the results. The trace view shows:
- **Timeline** — horizontal bars showing each span's duration
- **Span details** — click a span to see attributes (HTTP method, status code, database query, etc.)
- **Service flow** — which service called which, in what order

### Step 6 — Create a Dashboard Panel

From Explore, click "Add to dashboard" on a useful query. This creates a panel you can save. Common panels:
- **Request rate** — traces per minute by service
- **Latency distribution** — histogram of request durations
- **Error rate** — percentage of traces with error status

## Files Referenced

| File | Purpose |
|------|---------|
| `configs/grafana/datasources.yml` | Auto-provisions Tempo datasource on startup |
| `docker-compose.yml` (grafana service) | Container config: ports, volumes, auth settings |
| Volume: `grafana-data` | Persists dashboards, preferences, and state |
