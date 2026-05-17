# OpenTelemetry Collector

## What the OpenTelemetry Collector Is

The OpenTelemetry (OTel) Collector is a vendor-neutral telemetry pipeline that sits between your services and your observability backends. It receives traces (and optionally metrics and logs) from your applications, processes them (batching, filtering, enriching), and exports them to storage backends like Tempo.

Think of it as a **router for telemetry data**. Your services don't need to know where their traces end up — they just send OTLP data to the collector, and the collector handles the rest. If you later swap Tempo for Jaeger, or add a second backend, you change the collector config — not your application code.

## Why a Collector Instead of Direct Export

You could have your services send traces directly to Tempo. The collector adds an intermediate hop. Why bother?

1. **Decoupling** — your app code uses the standard OTLP protocol. The backend is a config change, not a code change.
2. **Batching** — the collector buffers spans and sends them in efficient batches. Direct export from each service would hammer Tempo with many small requests.
3. **Processing** — you can filter, sample, enrich, or transform telemetry data in the pipeline. Drop noisy health-check spans. Add environment tags. Sample 10% of traces in production.
4. **Fan-out** — one collector can export to multiple backends simultaneously (e.g., Tempo for traces AND Datadog for metrics) without changing any application code.
5. **Reliability** — the collector buffers data if the backend is temporarily unavailable. Direct export would lose traces during backend restarts.

## Architecture in the Workbench

```
┌──────────────────────────────────────────────────┐
│  Docker Network: workbench-network                │
│                                                    │
│  ┌────────────┐   OTLP/HTTP    ┌───────────────┐ │
│  │ mcp-server │ ──── :4318 ───▸│               │ │
│  └────────────┘                │  otel-collector│ │
│  ┌────────────┐   OTLP/HTTP    │               │──── gRPC :4317 ───▸ Tempo
│  │ rag-worker │ ──── :4318 ───▸│  (receives,   │ │
│  └────────────┘                │   batches,    │ │
│  ┌────────────┐   OTLP/HTTP    │   exports)    │ │
│  │ your app   │ ──── :4318 ───▸│               │ │
│  └────────────┘                └───────────────┘ │
│                                       │           │
│                                  Also logs to     │
│                                  stdout (warn)    │
└──────────────────────────────────────────────────┘
```

## How OpenTelemetry Works (Concepts)

### Traces, Spans, and Context

A **trace** represents one complete operation (e.g., a user query hitting the API). It has a unique trace ID.

A **span** is one unit of work within a trace (e.g., "call OpenRouter for embedding"). Spans have:
- A name (e.g., `POST /query`)
- A start and end time
- A parent span ID (creating the tree structure)
- Attributes (key-value pairs like `http.method=POST`, `http.status_code=200`)
- A status (OK, ERROR, UNSET)

**Context propagation** carries the trace ID across service boundaries. When `mcp-server` calls `rag-worker`, the trace ID is passed in HTTP headers so both services' spans appear in the same trace.

### The OTLP Protocol

OTLP (OpenTelemetry Protocol) is the standard wire format for telemetry data. It supports:
- **gRPC** (port 4317) — binary, efficient, bidirectional
- **HTTP/JSON** (port 4318) — simpler, easier to debug, works through proxies

The workbench uses HTTP/JSON (port 4318) for receiving from services because it's easier to debug (you can `curl` test data to it). It uses gRPC (port 4317) for exporting to Tempo because it's more efficient for bulk data.

## Configuration

**File:** `configs/otel/otel-collector-config.yml`

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: "0.0.0.0:4318"   # Listen for OTLP over HTTP

processors:
  batch:
    timeout: 5s                    # Flush every 5 seconds
    send_batch_size: 1024          # Or when 1024 spans accumulate

exporters:
  otlp/tempo:
    endpoint: "tempo:4317"         # Send to Tempo via gRPC
    tls:
      insecure: true               # No TLS within Docker network

  logging:
    loglevel: warn                 # Log errors/warnings to stdout

service:
  pipelines:
    traces:
      receivers: [otlp]            # Receive OTLP traces
      processors: [batch]          # Batch them
      exporters: [otlp/tempo, logging]  # Send to Tempo + log errors
```

### Configuration Anatomy

The collector config has four sections that form a **pipeline**:

#### 1. Receivers — How data gets in

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: "0.0.0.0:4318"
```

This creates an OTLP HTTP receiver on port 4318. Services send traces here. You can add multiple receivers:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: "0.0.0.0:4318"
      grpc:
        endpoint: "0.0.0.0:4317"
  zipkin:
    endpoint: "0.0.0.0:9411"       # Also accept Zipkin format
```

#### 2. Processors — Transform data in-flight

```yaml
processors:
  batch:
    timeout: 5s
    send_batch_size: 1024
```

The `batch` processor accumulates spans and flushes them periodically. This reduces the number of export calls and improves throughput.

Other useful processors:

```yaml
processors:
  # Filter out noisy spans
  filter:
    traces:
      span:
        - 'attributes["http.target"] == "/health"'  # Drop health checks

  # Add attributes to all spans
  attributes:
    actions:
      - key: environment
        value: dev
        action: upsert

  # Sample traces (keep 10% in production)
  probabilistic_sampler:
    sampling_percentage: 10
```

#### 3. Exporters — Where data goes

```yaml
exporters:
  otlp/tempo:
    endpoint: "tempo:4317"
    tls:
      insecure: true
```

The `otlp/tempo` exporter sends traces to Tempo. The `/tempo` suffix is just a label — you can have multiple OTLP exporters:

```yaml
exporters:
  otlp/tempo:
    endpoint: "tempo:4317"
    tls:
      insecure: true
  otlp/jaeger:
    endpoint: "jaeger:4317"
    tls:
      insecure: true
```

The `logging` exporter writes to stdout — useful for debugging the collector itself:

```yaml
exporters:
  logging:
    loglevel: debug    # See every span (very verbose)
```

#### 4. Service Pipelines — Wire it all together

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/tempo, logging]
```

This says: "For the `traces` pipeline, receive OTLP data, batch it, then export to both Tempo and the log." You can have separate pipelines for traces, metrics, and logs:

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/tempo]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [loki]
```

### Docker Compose Entry

**File:** `docker-compose.yml` (otel-collector service)

```yaml
otel-collector:
  image: otel/opentelemetry-collector-contrib:0.98.0
  container_name: otel-collector
  volumes:
    - ./configs/otel/otel-collector-config.yml:/etc/otelcol-contrib/config.yaml:ro
  ports:
    - "4318:4318"     # OTLP HTTP receiver (exposed to host for testing)
  networks:
    - workbench
```

The `contrib` distribution is used instead of the core distribution because it includes additional receivers, processors, and exporters that may be useful as you extend the workbench.

## Instrumenting Your Services

### Node.js / TypeScript

Add to your service's startup:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/traces',
    // e.g., http://otel-collector:4318/v1/traces
  }),
  instrumentations: [getNodeAutoInstrumentations()],
  serviceName: process.env.OTEL_SERVICE_NAME || 'my-service',
});

sdk.start();
```

The auto-instrumentations package automatically traces HTTP requests, database calls, Redis operations, and more — without any manual span creation.

### Python

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource

resource = Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME", "rag-worker")})
provider = TracerProvider(resource=resource)

exporter = OTLPSpanExporter(
    endpoint=os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318") + "/v1/traces"
)
provider.add_span_processor(BatchSpanProcessor(exporter))
trace.set_tracer_provider(provider)

# Create spans manually
tracer = trace.get_tracer(__name__)
with tracer.start_as_current_span("ingest-document") as span:
    span.set_attribute("document.path", filepath)
    # ... do work ...
```

### Environment Variables

Both the TS and Python services receive these env vars from docker-compose:

```yaml
environment:
  - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
  - OTEL_SERVICE_NAME=mcp-server   # or rag-worker
```

These are standard OTel SDK environment variables — any OTel-instrumented application recognizes them without custom code.

## Walkthrough: Testing the Collector

### Step 1 — Verify the collector is running

```bash
docker compose logs otel-collector | tail -5
```

Expected: startup logs with no errors.

### Step 2 — Send a test trace via curl

```bash
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d '{
    "resourceSpans": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "curl-test"}}
        ]
      },
      "scopeSpans": [{
        "spans": [{
          "traceId": "abcdef1234567890abcdef1234567890",
          "spanId": "1234567890abcdef",
          "name": "manual-test-span",
          "kind": 1,
          "startTimeUnixNano": "'$(date +%s)000000000'",
          "endTimeUnixNano": "'$(( $(date +%s) + 1 ))000000000'",
          "status": {"code": 1}
        }]
      }]
    }]
  }'
```

Expected: HTTP 200 (empty body or `{}`).

### Step 3 — Verify it reached Tempo

Check collector logs:
```bash
docker compose logs otel-collector | grep -i "traces\|export" | tail -5
```

Check Grafana: Explore → Tempo → Search → Service Name: `curl-test`.

### Step 4 — Check collector metrics (optional)

```bash
docker exec otel-collector wget -q -O - http://localhost:8888/metrics | grep otelcol_receiver
```

Shows how many spans the collector has received and exported.

## Files Referenced

| File | Purpose |
|------|---------|
| `configs/otel/otel-collector-config.yml` | Collector pipeline: receivers, processors, exporters |
| `configs/otel/tempo.yml` | Tempo config (the collector exports to Tempo) |
| `docker-compose.yml` (otel-collector service) | Container config: image, ports, volumes |
| `.env` (`OTEL_EXPORTER_OTLP_ENDPOINT`) | Env var pointing services to the collector |
