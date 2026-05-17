# Tempo — Trace Storage

## What Tempo Is

Grafana Tempo is a distributed tracing backend purpose-built for storing and querying traces. It receives trace data from the OpenTelemetry Collector via gRPC, stores it on local disk (or object storage in production), and serves queries to Grafana.

A **trace** is a record of a single operation as it flows through your system. When you call `POST /query` on the MCP server, a trace captures every step: the HTTP handler, the embedding API call to OpenRouter, the PostgreSQL hybrid search, the Claude LLM call, and the response assembly. Each step is a **span**, and spans are nested to show parent-child relationships.

Tempo stores these traces efficiently — it's designed for high-volume ingestion with minimal indexing overhead.

## Why Tempo and Not Jaeger or Zipkin

- **Jaeger** requires Elasticsearch or Cassandra as a storage backend. That's 2+ additional containers and significant memory overhead for a local dev tool.
- **Zipkin** stores data in MySQL or Cassandra. Same overhead problem.
- **Tempo** uses local disk with no external dependencies. One container, minimal memory, no database. It's the leanest trace backend available that still integrates natively with Grafana.

The tradeoff: Tempo doesn't index trace attributes for arbitrary querying (Jaeger does). You can search by trace ID, service name, duration, and status — but not by arbitrary span attributes. For a dev workbench, this is the right tradeoff: you want to see request flows and find slow operations, not run complex analytics queries over millions of traces.

## Architecture

```
OTel Collector ──── gRPC (:4317) ───▸ Tempo Distributor
                                         │
                                    Ingestion
                                         │
                                         ▼
                                    Tempo Storage
                                    /tmp/tempo/
                                    ├── blocks/   ← completed trace blocks
                                    └── wal/      ← write-ahead log (in-flight)
                                         │
                                    Query API
                                         │
                                         ▼
                              Grafana (:3200) queries
                              via HTTP (:3200 internal)
```

Tempo has three internal components, all running in the same container:
1. **Distributor** — receives traces from the OTel Collector via gRPC on port 4317
2. **Ingester** — buffers traces in the WAL (write-ahead log), then flushes to block storage
3. **Querier** — serves trace queries from Grafana via HTTP

## Configuration

**File:** `configs/otel/tempo.yml`

```yaml
server:
  http_listen_port: 3200        # HTTP API port (Grafana connects here)

distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: "0.0.0.0:4317"  # Receives traces from OTel Collector

storage:
  trace:
    backend: local              # Store on local disk (not S3/GCS)
    local:
      path: /tmp/tempo/blocks   # Where completed trace blocks live
    wal:
      path: /tmp/tempo/wal      # Write-ahead log for in-flight data

metrics_generator:
  storage:
    path: /tmp/tempo/metrics    # Optional: generate metrics from traces
```

### Configuration Fields Explained

**`server.http_listen_port`**: The HTTP port Tempo serves its query API on. Grafana's datasource config points to `http://tempo:3200`. This is internal to Docker — Tempo's port is not exposed to the host because only Grafana needs to talk to it.

**`distributor.receivers.otlp.protocols.grpc.endpoint`**: Where Tempo listens for incoming traces. The OTel Collector's exporter sends traces here via gRPC.

**`storage.trace.backend: local`**: For production, you'd use `s3` or `gcs` for durable storage. For a local dev workbench, `local` (filesystem) is correct — traces are ephemeral debugging data, not permanent records.

**`storage.trace.wal.path`**: The write-ahead log buffers incoming spans before they're flushed to blocks. If Tempo crashes, it replays the WAL on startup to recover in-flight traces.

### Docker Compose Entry

**File:** `docker-compose.yml` (tempo service)

```yaml
tempo:
  image: grafana/tempo:2.4.1
  container_name: tempo
  command: ["-config.file=/etc/tempo.yaml"]
  volumes:
    - ./configs/otel/tempo.yml:/etc/tempo.yaml:ro   # Config file
    - tempo-data:/tmp/tempo                          # Persistent storage
  networks:
    - workbench
```

Key details:
- **No exposed ports** — Tempo only needs to be reachable by the OTel Collector (gRPC :4317) and Grafana (HTTP :3200) on the Docker network. No host port mapping needed.
- **`tempo-data` volume** — persists traces across container restarts. Without this, you'd lose all traces every time you run `docker compose down`.
- **Config via command flag** — Tempo reads its config from the file specified by `-config.file`.

## Interfaces

### gRPC Receiver (Port 4317)

This is Tempo's primary ingestion interface. The OTel Collector connects here to push batched traces.

Protocol: gRPC + OTLP (OpenTelemetry Protocol)
Not meant for direct use — the OTel Collector handles all ingestion routing.

### HTTP Query API (Port 3200)

Grafana queries Tempo through this HTTP API. Key endpoints:

```bash
# Get a trace by ID (returns JSON)
curl http://tempo:3200/api/traces/<trace-id>

# Search traces (Grafana uses this behind the scenes)
curl "http://tempo:3200/api/search?service.name=mcp-server&limit=10"

# Health check
curl http://tempo:3200/ready
```

Note: these URLs use `tempo:3200` (Docker-internal). From the host, Tempo's HTTP port isn't mapped by default. If you need host access for debugging:

```yaml
# Add to docker-compose.yml tempo service:
ports:
  - "3200:3200"  # Caution: conflicts with Grafana's host port
```

### Tempo's Internal Data Format

Traces are stored as **blocks** — compressed files containing batches of traces. The block format:

```
/tmp/tempo/blocks/
├── <tenant-id>/
│   ├── <block-uuid>/
│   │   ├── meta.json      ← block metadata (time range, trace count)
│   │   ├── data.parquet    ← trace data (columnar, compressed)
│   │   └── bloom           ← bloom filter for trace ID lookups
```

You don't interact with these files directly. Grafana queries Tempo's HTTP API, which reads these blocks.

## Retention and Cleanup

By default, Tempo keeps traces indefinitely (until disk fills up). For a dev workbench, this is usually fine — trace data is small. If you need to limit retention, add to `tempo.yml`:

```yaml
compactor:
  compaction:
    block_retention: 72h    # Keep traces for 3 days
```

## Production Considerations

For deploying the workbench to the cloud (Phase 2 — Terraform), you'd change Tempo's storage backend:

```yaml
storage:
  trace:
    backend: s3
    s3:
      bucket: your-tempo-bucket
      endpoint: s3.us-east-1.amazonaws.com
      region: us-east-1
```

This gives you durable, scalable trace storage without managing disk. The rest of the config stays the same.

## Walkthrough: Verifying Tempo Is Working

### Step 1 — Check Tempo is ready

```bash
docker exec tempo wget -q -O - http://localhost:3200/ready
```

Expected: `ready`

### Step 2 — Check Grafana can reach Tempo

```bash
curl -s http://localhost:3200/api/datasources -u admin:admin \
  | python3 -c "
import sys, json
for ds in json.load(sys.stdin):
    if ds['type'] == 'tempo':
        print(f'Tempo datasource: {ds[\"name\"]} → {ds[\"url\"]}')
"
```

Expected: `Tempo datasource: Tempo → http://tempo:3200`

### Step 3 — Send a test trace manually

```bash
# Send a minimal OTLP trace to the OTel Collector (which forwards to Tempo)
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d '{
    "resourceSpans": [{
      "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "smoke-test"}}]},
      "scopeSpans": [{
        "spans": [{
          "traceId": "00000000000000000000000000000001",
          "spanId": "0000000000000001",
          "name": "test-span",
          "kind": 1,
          "startTimeUnixNano": "1700000000000000000",
          "endTimeUnixNano": "1700000001000000000",
          "status": {}
        }]
      }]
    }]
  }'
```

### Step 4 — Query the trace in Grafana

Open [http://localhost:3200](http://localhost:3200) → Explore → Tempo → Search tab → Service Name: `smoke-test`.

You should see the test trace. Click it to view the span timeline.

## Files Referenced

| File | Purpose |
|------|---------|
| `configs/otel/tempo.yml` | Tempo configuration: receiver, storage backend, WAL paths |
| `docker-compose.yml` (tempo service) | Container config: image, volumes, network |
| `configs/grafana/datasources.yml` | Tells Grafana where to find Tempo |
| Volume: `tempo-data` | Persists trace blocks and WAL across restarts |
