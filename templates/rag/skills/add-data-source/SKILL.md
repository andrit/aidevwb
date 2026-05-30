---
name: add-data-source
description: Add a new document type (JSON, CSV, code, API response) or live data source to the RAG knowledgebase — extraction patterns, chunking strategies per content type, metadata tagging, and refresh schedules
domain: rag
type: rag
triggers:
  - "add a new data source"
  - "ingest JSON"
  - "ingest CSV"
  - "ingest code"
  - "ingest API data"
  - "pull from an API"
  - "new file type"
  - "add a database as a source"
  - "sync from external source"
  - "add structured data to RAG"
  - "ingest Notion"
  - "ingest Confluence"
---

# Add a New Data Source

## When to use

When the knowledgebase needs content that doesn't exist as plain Markdown or PDF files — structured data (JSON, CSV), code, database records, or live API content (Confluence, Notion, Jira, REST APIs). Activate when the user says "I need to ingest data from X", "add our database as a source", or "pull documents from the API."

## Prerequisites

- Workbench running with at least one document already ingested (baseline working)
- Decision made: is this a one-time batch load or an ongoing sync?
- For API sources: API credentials and access confirmed

## The Two Ingestion Paths

```
Path A (File-based): Extract content → write to .md/.txt → /ingest <file>
  Use when: structured data that can be pre-processed offline
  Examples: JSON exports, CSV reports, database dumps, API snapshots

Path B (Script-based): Fetch → extract → ingest via API
  Use when: live data that needs to stay fresh
  Examples: Confluence pages, Jira tickets, REST API docs, database queries
```

Both paths end at `POST /ingest` — the difference is how you get there.

## Part A: New File Types

### JSON files

JSON objects don't chunk well by size because structure matters. Convert to readable Markdown before ingesting:

```python
# scripts/json_to_md.py — convert JSON records to ingestion-ready Markdown
import json
import sys
from pathlib import Path

def json_record_to_md(record: dict, title_field: str = "title") -> str:
    """Convert a single JSON record to Markdown."""
    title = record.get(title_field, record.get("id", "Record"))
    lines = [f"# {title}\n"]

    for key, value in record.items():
        if key == title_field:
            continue
        if isinstance(value, str) and len(value) > 20:
            lines.append(f"## {key.replace('_', ' ').title()}\n{value}\n")
        elif isinstance(value, list):
            lines.append(f"## {key.replace('_', ' ').title()}\n")
            for item in value:
                lines.append(f"- {item}")
            lines.append("")
        else:
            lines.append(f"**{key}:** {value}")

    return "\n".join(lines)

def convert_file(input_path: str, output_dir: str, title_field: str = "title"):
    data = json.loads(Path(input_path).read_text())
    records = data if isinstance(data, list) else [data]

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    for i, record in enumerate(records):
        title = str(record.get(title_field, f"record-{i}")).replace(" ", "-").lower()
        output_path = out / f"{title}.md"
        output_path.write_text(json_record_to_md(record, title_field))
        print(f"  → {output_path}")

if __name__ == "__main__":
    convert_file(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "title")
```

```bash
python scripts/json_to_md.py data/products.json /project/ingested/products name
# Then ingest all generated files
bash scripts/ingest_dir.sh /project/ingested/products
```

### CSV files

CSVs work best when each row is a self-contained document. For narrow tables (few columns, many rows), group related rows first:

```python
# scripts/csv_to_md.py — convert CSV rows to Markdown documents
import csv
import sys
from pathlib import Path

def csv_to_md_files(csv_path: str, output_dir: str, id_field: str = None):
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            # Use id_field as filename if provided
            name = str(row.get(id_field, i)).replace(" ", "-").lower() if id_field else str(i)
            md = "# " + (row.get(id_field) or f"Record {i}") + "\n\n"
            for key, value in row.items():
                if value:
                    md += f"**{key}:** {value}\n"

            (out / f"{name}.md").write_text(md)

if __name__ == "__main__":
    csv_to_md_files(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
```

### Code files

Code benefits from richer metadata (language, function signatures):

```python
# scripts/code_to_md.py — convert source files to documented Markdown
import ast
import sys
from pathlib import Path

def python_file_to_md(filepath: str) -> str:
    path = Path(filepath)
    source = path.read_text()

    lines = [f"# {path.name}\n", f"**Language:** Python  \n**Path:** `{filepath}`\n"]

    # Extract docstrings and function signatures
    try:
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                sig = f"def {node.name}({', '.join(a.arg for a in node.args.args)})"
                doc = ast.get_docstring(node) or ""
                lines.append(f"## `{sig}`\n{doc}\n")
    except SyntaxError:
        pass

    lines.append(f"## Source\n```python\n{source}\n```")
    return "\n".join(lines)

if __name__ == "__main__":
    print(python_file_to_md(sys.argv[1]))
```

For TypeScript/JavaScript, use JSDoc comments. The key principle: **include the function signature and docstring as plaintext** at the top of the chunk so search can find it without needing to parse the code.

## Part B: Live API Sources

### Generic REST API fetch-and-ingest script

```python
# scripts/fetch_and_ingest.py — fetch from REST API, convert, ingest
"""
Fetches documents from a paginated REST API and ingests them into the RAG knowledgebase.
Designed to be run on a schedule (cron or `make refresh-<source>`).

Usage:
  python scripts/fetch_and_ingest.py \
    --api-url https://api.example.com/articles \
    --api-key $MY_API_KEY \
    --output-dir /project/ingested/articles \
    --mcp-url http://localhost:3100 \
    --project $WORKBENCH_PROJECT
"""
import argparse
import json
import os
import re
import tempfile
import time
from pathlib import Path

import httpx


def fetch_pages(api_url: str, headers: dict, page_size: int = 50):
    """Fetch all pages from a paginated API."""
    page = 1
    while True:
        resp = httpx.get(api_url, headers=headers,
                         params={"page": page, "per_page": page_size}, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        items = data if isinstance(data, list) else data.get("items", data.get("data", []))
        if not items:
            break
        yield from items
        page += 1
        if isinstance(data, dict) and not data.get("has_more"):
            break
        time.sleep(0.1)  # polite rate limiting


def record_to_md(record: dict, title_field: str = "title") -> str:
    title = record.get(title_field) or record.get("name") or f"Record {record.get('id', '?')}"
    md = f"# {title}\n\n"
    for key, value in record.items():
        if isinstance(value, str) and len(value) > 50:
            label = key.replace("_", " ").title()
            md += f"## {label}\n{value}\n\n"
        elif value is not None:
            md += f"**{key}:** {value}\n"
    return md


def ingest_file(filepath: str, mcp_url: str, project: str):
    resp = httpx.post(f"{mcp_url}/ingest",
                      json={"filepath": filepath},
                      headers={"X-Project": project},
                      timeout=30)
    resp.raise_for_status()
    return resp.json()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--api-key", default=os.environ.get("SOURCE_API_KEY", ""))
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--mcp-url", default="http://localhost:3100")
    parser.add_argument("--project", default=os.environ.get("WORKBENCH_PROJECT"))
    args = parser.parse_args()

    headers = {"Authorization": f"Bearer {args.api_key}"} if args.api_key else {}
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)

    count = 0
    for record in fetch_pages(args.api_url, headers):
        # Derive a stable filename from the record ID
        record_id = str(record.get("id") or count)
        safe_id = re.sub(r"[^a-zA-Z0-9_-]", "-", record_id)
        filepath = str(output / f"{safe_id}.md")

        (output / f"{safe_id}.md").write_text(record_to_md(record))
        result = ingest_file(filepath, args.mcp_url, args.project)
        print(f"  [{result.get('status', '?')}] {filepath}")
        count += 1

    print(f"\nFetched and ingested {count} records.")


if __name__ == "__main__":
    main()
```

### Confluence / Notion / Jira patterns

For these platforms, use their official export or API:

```bash
# Confluence: export space to HTML, convert to Markdown
# Install: pip install confluence-to-md (or similar)
# Then: ingest each .md file

# Notion: export workspace to Markdown (Settings → Export)
# Then: ingest the exported .md files directly

# Jira: fetch via REST API
python scripts/fetch_and_ingest.py \
  --api-url "https://yourorg.atlassian.net/rest/api/3/search?jql=project=PROJ" \
  --api-key "$JIRA_API_TOKEN" \
  --output-dir /project/ingested/jira \
  --project $WORKBENCH_PROJECT
```

### Database as a source

```python
# scripts/db_to_ingest.py — export database records as Markdown docs
import psycopg2
import os
from pathlib import Path

def export_table_to_md(table: str, id_col: str, content_cols: list[str],
                       output_dir: str, db_url: str):
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute(f"SELECT {id_col}, {', '.join(content_cols)} FROM {table}")

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    for row in cur.fetchall():
        record_id = row[0]
        md = f"# {table} record {record_id}\n\n"
        for col, val in zip(content_cols, row[1:]):
            if val:
                md += f"## {col.replace('_', ' ').title()}\n{val}\n\n"

        (out / f"{record_id}.md").write_text(md)
    conn.close()

export_table_to_md(
    table="knowledge_articles",
    id_col="id",
    content_cols=["title", "body", "tags"],
    output_dir="/project/ingested/articles",
    db_url=os.environ["DATABASE_URL"],
)
```

## Adding Metadata Tags

Metadata improves filtering and attribution in query results. Add metadata to a document by including structured frontmatter at the top of the Markdown:

```markdown
---
source: confluence
category: engineering
updated_at: 2025-01-15
author: Alice Smith
version: 2.3
---

# Page Title

Content starts here...
```

The RAG worker stores this in the `metadata` JSON column of the `documents` table. You can filter by it in queries if you extend the hybrid search function (see `tune-search-quality`).

## Setting Up a Refresh Schedule

For live sources, add a Make target that re-runs the ingest script on a schedule:

```makefile
# Makefile — add to your project
refresh-articles:
	python scripts/fetch_and_ingest.py \
		--api-url $(SOURCE_API_URL) \
		--api-key $(SOURCE_API_KEY) \
		--output-dir /project/ingested/articles \
		--project $(WORKBENCH_PROJECT)

# Run refresh daily via cron:
# 0 2 * * * cd /path/to/project && make refresh-articles >> /var/log/rag-refresh.log 2>&1
```

For deduplication on refresh: the RAG worker uses SHA-256 file hashes to skip unchanged files. As long as you write the same file content to the same path, reingesting will be a no-op for unchanged records.

## Checklist

- [ ] Content type identified: text, structured, code, or live API
- [ ] Extraction script written that converts source to Markdown
- [ ] Each output file is self-contained (answers a question without needing adjacent files)
- [ ] Metadata frontmatter added where source/category filtering will be useful
- [ ] Single file ingested and searchable before batch ingest
- [ ] Batch ingest complete; queue drained
- [ ] Eval set updated with 2-3 queries covering the new source
- [ ] Eval run confirms new source is searchable (not just that status shows docs count)
- [ ] For live sources: refresh script in `scripts/`, Make target defined, cron scheduled

## Files involved

| File | Action |
|------|--------|
| `scripts/json_to_md.py` | Create: JSON → Markdown converter |
| `scripts/csv_to_md.py` | Create: CSV → Markdown converter |
| `scripts/fetch_and_ingest.py` | Create: generic API fetch + ingest script |
| `scripts/db_to_ingest.py` | Create: database export + ingest script |
| `Makefile` | Add `refresh-<source>` targets for live sources |
| `evals/baseline.json` | Update: add queries covering the new source |

## Common mistakes

**Ingesting raw JSON/CSV** — the RAG worker can only process text and multimodal files. A `.json` file with array structure will be chunked by character count, splitting JSON objects at arbitrary boundaries. Always convert to Markdown first.

**One huge file instead of many small files** — ingesting a single `all-articles.md` with 200 articles concatenated means every chunk is from that one document. The deduplification hash won't help because the file always changes. One document per topic or record is better.

**No metadata tagging** — when all documents have the same metadata, you can't filter by source, category, or date. Add at least `source` and `category` to distinguish data origin — it makes debugging retrieval much easier.

**Not verifying new source is searchable** — the `/status` doc count going up doesn't prove the content is retrievable. Run `/query` with a question that only the new source can answer before declaring success.

**No deduplication on refresh** — if the refresh script creates new files with new names each run (e.g., with timestamps in the filename), every refresh creates duplicate documents. Use stable filenames based on record IDs so the SHA-256 check skips unchanged content.
