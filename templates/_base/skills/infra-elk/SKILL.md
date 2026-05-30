---
name: infra-elk
description: Add the ELK stack for log aggregation — Elasticsearch index templates, Logstash pipeline parsing workbench JSON logs, Kibana dashboard for workbench requests, and Filebeat config
domain: infrastructure
type: cross-cutting
triggers:
  - "ELK"
  - "elasticsearch"
  - "logstash"
  - "kibana"
  - "log aggregation"
  - "centralized logging"
  - "filebeat"
  - "log pipeline"
  - "log search"
---

# ELK Stack Log Aggregation

## When to use

When the workbench's built-in Grafana/Tempo observability (traces + metrics) is not enough and you need full-text search over structured logs across all containers. Common triggers:

- You need to search log messages by content (`error`, specific document IDs, stack traces)
- Multiple workbench instances (dev/staging/prod) need logs in one place
- Compliance or audit requirements mandate log retention in a queryable store
- You want Kibana dashboards for request counts, error rates, and latency percentiles derived from logs rather than traces

The workbench already ships Grafana + Tempo for tracing. ELK is additive: Tempo shows *how* a request flowed, Kibana shows *what was logged* across all services.

## Prerequisites

- Docker and `docker compose` running
- At least 4 GB RAM free (Elasticsearch alone needs ~1.5 GB)
- The workbench running (`make up`) — mcp-server writes JSON logs to stdout
- `vm.max_map_count` set to at least 262144 on Linux: `sudo sysctl -w vm.max_map_count=262144` (required by Elasticsearch)

## Step 1 — Add ELK services to docker-compose.yml

```yaml
# ═══════════════════════════════════════════════════════════
#  ELK STACK — Centralized log aggregation
#  Optional: docker compose --profile elk up -d
# ═══════════════════════════════════════════════════════════
elasticsearch:
  image: docker.elastic.co/elasticsearch/elasticsearch:8.13.0
  container_name: elasticsearch
  profiles: ["elk"]
  environment:
    discovery.type: single-node
    ES_JAVA_OPTS: "-Xms1g -Xmx1g"
    xpack.security.enabled: "false"     # disable auth for local dev
    xpack.security.http.ssl.enabled: "false"
  ports:
    - "9200:9200"
  volumes:
    - es-data:/usr/share/elasticsearch/data
  networks:
    - workbench
  healthcheck:
    test: ["CMD-SHELL", "curl -sf http://localhost:9200/_cluster/health | grep -qv '\"status\":\"red\"'"]
    interval: 20s
    timeout: 10s
    retries: 5
    start_period: 60s

logstash:
  image: docker.elastic.co/logstash/logstash:8.13.0
  container_name: logstash
  profiles: ["elk"]
  ports:
    - "5044:5044"     # Beats input
    - "5000:5000/tcp" # TCP input (optional direct send)
  volumes:
    - ./configs/logstash/pipeline:/usr/share/logstash/pipeline:ro
    - ./configs/logstash/templates:/usr/share/logstash/templates:ro
  environment:
    LS_JAVA_OPTS: "-Xms512m -Xmx512m"
  networks:
    - workbench
  depends_on:
    elasticsearch:
      condition: service_healthy

kibana:
  image: docker.elastic.co/kibana/kibana:8.13.0
  container_name: kibana
  profiles: ["elk"]
  ports:
    - "5601:5601"
  environment:
    ELASTICSEARCH_HOSTS: http://elasticsearch:9200
    SERVER_BASEPATH: ""
    XPACK_SECURITY_ENABLED: "false"
  networks:
    - workbench
  depends_on:
    elasticsearch:
      condition: service_healthy

filebeat:
  image: docker.elastic.co/beats/filebeat:8.13.0
  container_name: filebeat
  profiles: ["elk"]
  user: root                           # needs root to read /var/lib/docker/containers
  volumes:
    - ./configs/filebeat/filebeat.yml:/usr/share/filebeat/filebeat.yml:ro
    - /var/lib/docker/containers:/var/lib/docker/containers:ro
    - /var/run/docker.sock:/var/run/docker.sock:ro
    - filebeat-data:/usr/share/filebeat/data
  networks:
    - workbench
  depends_on:
    - logstash
```

Add volumes:

```yaml
volumes:
  es-data:
  filebeat-data:
```

Start ELK:

```bash
docker compose --profile elk up -d
```

## Step 2 — Filebeat config

Create `configs/filebeat/filebeat.yml`. Filebeat tails container logs and forwards to Logstash.

```yaml
# configs/filebeat/filebeat.yml
filebeat.inputs:
  - type: container
    paths:
      - /var/lib/docker/containers/*/*.log
    # Only collect logs from workbench containers
    processors:
      - add_docker_metadata:
          host: "unix:///var/run/docker.sock"
      - drop_event:
          when:
            not:
              or:
                - equals:
                    docker.container.name: "mcp-server"
                - equals:
                    docker.container.name: "rag-worker"
                - equals:
                    docker.container.name: "claude-code"

output.logstash:
  hosts: ["logstash:5044"]

logging.level: warning
```

## Step 3 — Logstash pipeline

The mcp-server emits structured JSON logs via pino (or console.log with JSON). Create `configs/logstash/pipeline/workbench.conf`:

```ruby
# configs/logstash/pipeline/workbench.conf
input {
  beats {
    port => 5044
  }
}

filter {
  # ── Parse container name from Filebeat metadata ───────────
  if [docker][container][name] {
    mutate {
      add_field => { "service" => "%{[docker][container][name]}" }
    }
  }

  # ── Try to parse the message as JSON ─────────────────────
  # mcp-server uses pino which emits one JSON object per line
  json {
    source  => "message"
    target  => "log"
    remove_field => ["message"]
  }

  # ── Map pino fields to ECS (Elastic Common Schema) ────────
  if [log][level] {
    mutate {
      rename => { "[log][level]" => "log.level" }
    }
    # pino levels: 10=trace 20=debug 30=info 40=warn 50=error 60=fatal
    if [log][level] == "10" { mutate { replace => { "log.level" => "trace" } } }
    if [log][level] == "20" { mutate { replace => { "log.level" => "debug" } } }
    if [log][level] == "30" { mutate { replace => { "log.level" => "info"  } } }
    if [log][level] == "40" { mutate { replace => { "log.level" => "warn"  } } }
    if [log][level] == "50" { mutate { replace => { "log.level" => "error" } } }
    if [log][level] == "60" { mutate { replace => { "log.level" => "fatal" } } }
  }

  # ── Extract HTTP request fields ────────────────────────────
  if [log][req] {
    mutate {
      rename => { "[log][req][method]"     => "http.request.method"     }
      rename => { "[log][req][url]"        => "url.path"                }
      rename => { "[log][res][statusCode]" => "http.response.status_code" }
      rename => { "[log][responseTime]"    => "event.duration"          }
    }
  }

  # ── Extract project name from URL ──────────────────────────
  if [url][path] {
    grok {
      match => { "[url][path]" => "/projects/%{DATA:project_name}/" }
      tag_on_failure => []
    }
  }

  # ── Timestamps ─────────────────────────────────────────────
  if [log][time] {
    date {
      match    => ["[log][time]", "UNIX_MS"]
      target   => "@timestamp"
      timezone => "UTC"
    }
    mutate { remove_field => ["[log][time]"] }
  }

  # ── Drop noisy health check logs ──────────────────────────
  if [url][path] == "/health" {
    drop {}
  }
}

output {
  elasticsearch {
    hosts     => ["elasticsearch:9200"]
    index     => "workbench-logs-%{+YYYY.MM.dd}"
    template_name => "workbench-logs"
    template  => "/usr/share/logstash/templates/workbench-index-template.json"
    template_overwrite => true
  }
}
```

## Step 4 — Elasticsearch index template

Create `configs/logstash/templates/workbench-index-template.json`. This maps fields correctly so Kibana can aggregate on them.

```json
{
  "index_patterns": ["workbench-logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 0,
      "index.lifecycle.name": "workbench-logs-policy"
    },
    "mappings": {
      "properties": {
        "@timestamp":                       { "type": "date" },
        "service":                          { "type": "keyword" },
        "log.level":                        { "type": "keyword" },
        "project_name":                     { "type": "keyword" },
        "http.request.method":              { "type": "keyword" },
        "http.response.status_code":        { "type": "integer" },
        "url.path":                         { "type": "keyword" },
        "event.duration":                   { "type": "long" },
        "log.msg":                          { "type": "text", "fields": { "keyword": { "type": "keyword", "ignore_above": 256 } } },
        "log.err":                          { "type": "object" },
        "log.traceId":                      { "type": "keyword" },
        "log.spanId":                       { "type": "keyword" }
      }
    }
  }
}
```

## Step 5 — Kibana data view and dashboard

After ELK is up and logs are flowing:

1. Open Kibana at http://localhost:5601
2. Go to **Stack Management → Data Views → Create data view**
   - Index pattern: `workbench-logs-*`
   - Timestamp field: `@timestamp`
3. Go to **Discover** to confirm logs are indexed
4. Create a **Dashboard** with these panels:

| Panel | Visualization | Config |
|-------|--------------|--------|
| Request rate | Area chart | Y: count(), split by `service`, interval: 1m |
| Error rate | Line chart | Filter: `log.level: error OR warn`, Y: count() |
| Status codes | Pie chart | Donut on `http.response.status_code` |
| Slowest routes | Data table | Top 10 by `event.duration` desc, columns: `url.path`, `event.duration` |
| Log stream | Discover | Filter: `log.level: error` |

## Checklist

- [ ] `vm.max_map_count` set to 262144 on host (`sysctl vm.max_map_count` to check)
- [ ] All four ELK services in `docker-compose.yml` under `elk` profile
- [ ] `configs/filebeat/filebeat.yml` scoped to workbench containers only
- [ ] `configs/logstash/pipeline/workbench.conf` parses JSON and maps pino numeric levels to strings
- [ ] Health check logs dropped in Logstash pipeline (reduces noise)
- [ ] Elasticsearch index template applied: `workbench-logs-*` pattern
- [ ] Kibana data view created, `@timestamp` is timestamp field
- [ ] Logs visible in Kibana Discover within 30 seconds of container start
- [ ] `log.level: error` filter works in Kibana

## Files involved

| File | Action |
|------|--------|
| `docker-compose.yml` | Add `elasticsearch`, `logstash`, `kibana`, `filebeat` under `elk` profile; add volumes |
| `configs/filebeat/filebeat.yml` | Create: container log collector scoped to workbench containers |
| `configs/logstash/pipeline/workbench.conf` | Create: JSON parse, pino level mapping, HTTP field extraction |
| `configs/logstash/templates/workbench-index-template.json` | Create: Elasticsearch field mappings |

## Common mistakes

**Not setting `vm.max_map_count`** — Elasticsearch refuses to start on Linux if this is below 262144. The container exits immediately with `max virtual memory areas vm.max_map_count [65530] is too low`. Fix: `sudo sysctl -w vm.max_map_count=262144` and add to `/etc/sysctl.conf` for persistence.

**JSON parse errors flooding Logstash** — when a container emits non-JSON lines (e.g., startup banners, stack traces as plain text), the `json` filter fails and tags the event `_jsonparsefailure`. Those events still get indexed with the raw `message` field. Add a `drop {}` or handle `_jsonparsefailure` explicitly to avoid polluting the index.

**Mapping explosion from dynamic fields** — Elasticsearch's default dynamic mapping creates new fields for every key in JSON logs. A mcp-server log with arbitrary metadata can create thousands of fields, exhausting the 1000-field default limit. Set `"dynamic": "strict"` in the index template and explicitly map every field you need.

**Filebeat running as non-root** — container log files under `/var/lib/docker/containers/` are owned by root. Running Filebeat without `user: root` (or without appropriate volume permissions) causes silent collection failure: Filebeat starts, finds no files, and logs nothing.

**ELK on every `make up`** — profiles keep ELK opt-in. Never move ELK services out of the `elk` profile or the default `make up` will OOM on developer laptops.
