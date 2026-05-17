# {{PROJECT_NAME}} — Production Stack

This stack was exported from the AI Dev Workbench. It is **fully independent** — no reference to or dependency on the workbench.

## Quick Start

```bash
cp .env.example .env
# Fill in your API keys and set a strong POSTGRES_PASSWORD
nano .env

docker compose up -d
```

## Services

| Service | Port | Purpose |
|---------|------|---------|
| postgres | 5432 | PostgreSQL + pgvector (RAG storage) |
| redis | 6379 | Job queue + cache |
| api | 3100 | REST API (ingest, query, status) |
| worker | — | Background document processing |

## API Endpoints

```
GET  /health   — health check
POST /ingest   — ingest a document {"filepath": "/path/to/file"}
POST /query    — search + answer {"question": "...", "top_k": 5}
GET  /status   — knowledgebase stats
```

## Seeding Data

If a `seed-data.sql.gz` file was included:

```bash
gunzip -c seed-data.sql.gz | docker exec -i {{PROJECT_NAME}}-db psql -U postgres -d {{PROJECT_NAME}}
```

## Customizing

- **System prompt**: edit `api/src/services/llm.ts` to change the answer generation prompt
- **Search weights**: edit `api/src/config.ts` (`vectorWeight`, `textWeight`)
- **Chunk size**: edit `api/src/config.ts` (`chunkSize`, `chunkOverlap`)
- **Migrations**: add new `.sql` files to `migrations/`
