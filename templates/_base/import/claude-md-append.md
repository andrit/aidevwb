
---
<!-- Added by AI Dev Workbench — remove this section if you disconnect from the workbench -->

## Workbench Integration

This project is registered with the AI Dev Workbench.

### Available Tools
- `/ingest <file>` — add a document to the project knowledgebase
- `/query <question>` — search the knowledgebase and get an answer
- `/status` — knowledgebase stats (documents, chunks, model)
- `/test` — run the project's test suite
- `/remember <key> <value>` — store persistent state
- `/recall <key>` — retrieve persistent state
- `/eval` — evaluate search quality

### Knowledgebase
- Hybrid search: 70% vector similarity + 30% keyword matching
- SHA256 dedup: unchanged files are skipped on re-ingest
- Documents directory: `/workspace/documents/`

### Observability
- Grafana dashboards: http://localhost:3200
- Traces flow through OpenTelemetry → Tempo → Grafana
