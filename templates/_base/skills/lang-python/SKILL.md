---
name: lang-python
description: Python for ML/RAG extension — asyncio patterns, httpx for async HTTP to the workbench API, Pydantic v2 for validation, and extending the rag-worker with custom processors
domain: language
type: cross-cutting
triggers:
  - "python"
  - "asyncio"
  - "pydantic"
  - "extend rag worker"
  - "python agent"
  - "python ml"
  - "python pipeline"
  - "rag extension"
---

# Python (ML / RAG Extension)

## When to use

Use this skill when extending the workbench's existing Python infrastructure — the `rag-worker` (`apps/rag-worker/`) — with custom document processors, embedding pipelines, or ML-driven agents. Also use for standalone Python agents or scripts that call the workbench MCP server API. The workbench already runs Python 3.11 in the `rag-worker` container; new code should fit into that environment rather than creating a parallel service unless isolation is truly needed.

## Prerequisites

- Python 3.11+ (the `rag-worker` container uses `python:3.11-slim`)
- Existing `apps/rag-worker/requirements.txt` for dependencies shared with the worker
- `WORKBENCH_PROJECT` and `MCP_SERVER_URL` env vars set (available in all workbench containers)
- Workbench MCP server running (`make up`)

## Project Layout

For extensions to the rag-worker:
```
apps/rag-worker/
├── lib/
│   ├── __init__.py
│   ├── worker.py          — existing worker (do not modify core logic)
│   ├── processors/
│   │   ├── __init__.py
│   │   ├── base.py        — BaseProcessor ABC
│   │   └── custom.py      — YOUR new processor
│   └── agents/
│       ├── __init__.py
│       └── my_agent.py    — YOUR new agent
├── requirements.txt
└── Dockerfile
```

For a standalone Python agent in a project:
```
src/
├── __init__.py
├── main.py
├── agent.py
├── workbench_client.py
└── models.py              — Pydantic models
```

## Pydantic v2 Model Templates

Pydantic is the single source of truth for data shapes — same philosophy as Zod in TypeScript:

```python
# src/models.py
from __future__ import annotations
from typing import Any
from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import datetime


class DocumentInput(BaseModel):
    """Input for ingesting a document into the RAG pipeline."""
    url: str
    content: str | None = None
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("url")
    @classmethod
    def url_must_be_absolute(cls, v: str) -> str:
        if not v.startswith(("http://", "https://", "file://")):
            raise ValueError(f"URL must be absolute, got: {v!r}")
        return v

    @model_validator(mode="after")
    def url_or_content_required(self) -> "DocumentInput":
        if self.url is None and self.content is None:
            raise ValueError("either url or content must be provided")
        return self


class QueryResult(BaseModel):
    id: str
    content: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class QueryResponse(BaseModel):
    results: list[QueryResult]
    total: int


class MemoryRecord(BaseModel):
    key: str
    value: str
    created_at: datetime


# Parse from dict (raises ValidationError with field-level messages on failure):
# doc = DocumentInput.model_validate(raw_dict)

# Serialize to dict / JSON:
# doc.model_dump()
# doc.model_dump_json()
```

## Async HTTP Client for Workbench API

Use `httpx` (not `requests`) for async code. The workbench containers can reach the MCP server at `http://mcp-server:3100`:

```python
# src/workbench_client.py
from __future__ import annotations
import os
from typing import Any
import httpx
from pydantic import TypeAdapter
from .models import QueryResponse, MemoryRecord, DocumentInput


class WorkbenchClient:
    """Async HTTP client for the workbench MCP server REST API."""

    def __init__(
        self,
        base_url: str | None = None,
        project: str | None = None,
    ) -> None:
        self.base_url = (base_url or os.environ.get("MCP_SERVER_URL", "http://mcp-server:3100")).rstrip("/")
        self.project = project or os.environ["WORKBENCH_PROJECT"]
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "WorkbenchClient":
        self._client = httpx.AsyncClient(timeout=30.0)
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()

    @property
    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            raise RuntimeError("Use WorkbenchClient as an async context manager")
        return self._client

    def _url(self, path: str) -> str:
        return f"{self.base_url}/projects/{self.project}{path}"

    async def ingest(self, doc: DocumentInput) -> dict[str, Any]:
        res = await self._http.post(self._url("/ingest"), json=doc.model_dump())
        res.raise_for_status()
        return res.json()

    async def query(self, q: str, limit: int = 5) -> QueryResponse:
        res = await self._http.post(
            self._url("/query"), json={"query": q, "limit": limit}
        )
        res.raise_for_status()
        return QueryResponse.model_validate(res.json())

    async def remember(self, key: str, value: str) -> None:
        res = await self._http.post(
            self._url("/memories"), json={"key": key, "value": value}
        )
        res.raise_for_status()

    async def recall(self, key: str) -> MemoryRecord | None:
        res = await self._http.get(self._url(f"/memories/{key}"))
        if res.status_code == 404:
            return None
        res.raise_for_status()
        return MemoryRecord.model_validate(res.json())

    async def publish(self, channel: str, payload: Any) -> None:
        res = await self._http.post(
            self._url("/bus/publish"), json={"channel": channel, "payload": payload}
        )
        res.raise_for_status()

    async def read_bus(self, channel: str, limit: int = 10) -> list[dict[str, Any]]:
        res = await self._http.get(self._url(f"/bus/{channel}?limit={limit}"))
        res.raise_for_status()
        return res.json().get("messages", [])
```

## Asyncio Patterns

```python
# src/main.py
import asyncio
import signal
import sys

from .agent import MyAgent
from .workbench_client import WorkbenchClient


async def run() -> None:
    async with WorkbenchClient() as wb:
        agent = MyAgent(wb)

        # Graceful shutdown on SIGINT/SIGTERM
        loop = asyncio.get_running_loop()
        stop_event = asyncio.Event()

        def _shutdown(sig: signal.Signals) -> None:
            print(f"\nReceived {sig.name}, shutting down...")
            stop_event.set()

        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, _shutdown, sig)

        await agent.run_until(stop_event)


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
```

### Concurrent Workbench Calls

```python
import asyncio

async def enrich_document(wb: WorkbenchClient, doc_id: str, content: str) -> dict:
    # Fan out: run multiple API calls concurrently
    query_task = asyncio.create_task(wb.query(content, limit=3))
    memory_task = asyncio.create_task(wb.recall(f"doc_context:{doc_id}"))

    results, memory = await asyncio.gather(query_task, memory_task, return_exceptions=True)

    # Handle partial failures gracefully
    chunks = results.results if not isinstance(results, BaseException) else []
    ctx = memory.value if (memory and not isinstance(memory, BaseException)) else ""

    return {"id": doc_id, "related_chunks": chunks, "context": ctx}
```

## Extending the RAG Worker

The `rag-worker` processes documents. Add a custom processor without modifying the core worker:

```python
# apps/rag-worker/lib/processors/base.py
from abc import ABC, abstractmethod
from typing import Any


class BaseProcessor(ABC):
    """Processors transform raw document content before chunking."""

    @abstractmethod
    async def process(self, content: str, metadata: dict[str, Any]) -> str:
        """Return transformed content."""
        ...

    @property
    @abstractmethod
    def supported_mime_types(self) -> list[str]:
        """MIME types this processor handles."""
        ...
```

```python
# apps/rag-worker/lib/processors/custom.py
import re
from typing import Any
from .base import BaseProcessor


class MarkdownTableProcessor(BaseProcessor):
    """Converts markdown tables to structured text for better chunking."""

    supported_mime_types = ["text/markdown", "text/x-markdown"]

    async def process(self, content: str, metadata: dict[str, Any]) -> str:
        return self._flatten_tables(content)

    def _flatten_tables(self, text: str) -> str:
        """Replace markdown tables with pipe-separated key:value pairs."""
        lines = text.splitlines()
        output: list[str] = []
        headers: list[str] = []
        in_table = False

        for line in lines:
            if re.match(r"^\|.*\|$", line):
                cells = [c.strip() for c in line.strip("|").split("|")]
                if not in_table:
                    headers = cells
                    in_table = True
                elif re.match(r"^[\s|:-]+$", line):
                    continue  # separator row
                else:
                    pairs = " | ".join(f"{h}: {v}" for h, v in zip(headers, cells))
                    output.append(pairs)
            else:
                in_table = False
                headers = []
                output.append(line)

        return "\n".join(output)
```

```python
# apps/rag-worker/lib/worker.py (addition — do not replace existing code)
# In the existing worker, add processor registration. Find the process_document
# function and add a call to match MIME type to processor:

from .processors.custom import MarkdownTableProcessor

PROCESSORS = {
    mime: MarkdownTableProcessor()
    for mime in MarkdownTableProcessor.supported_mime_types
}

async def apply_processor(content: str, mime_type: str, metadata: dict) -> str:
    processor = PROCESSORS.get(mime_type)
    if processor:
        return await processor.process(content, metadata)
    return content
```

## requirements.txt Additions

```
# Add to apps/rag-worker/requirements.txt
httpx>=0.27.0
pydantic>=2.7.0
```

## Checklist

- [ ] Pydantic v2 used (not v1) — `model_validate`, `model_dump`, not `parse_obj`, `dict()`
- [ ] `WorkbenchClient` used as an async context manager (`async with WorkbenchClient() as wb`)
- [ ] Signal handlers set in entry point for graceful SIGINT/SIGTERM shutdown
- [ ] Concurrent workbench calls use `asyncio.gather`, not sequential `await`
- [ ] Custom processor extends `BaseProcessor` ABC with correct MIME types declared
- [ ] `MCP_SERVER_URL` read from env (defaults to `http://mcp-server:3100`)
- [ ] New dependencies added to `requirements.txt` before building container
- [ ] `from __future__ import annotations` at top of all model files (deferred evaluation)

## Files involved

| File | Action |
|------|--------|
| `src/models.py` | Create: Pydantic models for all data shapes |
| `src/workbench_client.py` | Create: async httpx client for MCP server |
| `src/agent.py` | Create: agent logic using WorkbenchClient |
| `src/main.py` | Create: asyncio entry point with signal handling |
| `apps/rag-worker/lib/processors/base.py` | Create: BaseProcessor ABC |
| `apps/rag-worker/lib/processors/custom.py` | Create: custom processor implementation |
| `apps/rag-worker/requirements.txt` | Modify: add httpx, pydantic>=2.7 |

## Common mistakes

**Using Pydantic v1 API with v2 installed** — Pydantic v2 breaks backward compatibility. `parse_obj` is gone; use `model_validate`. `.dict()` is deprecated; use `.model_dump()`. The error `AttributeError: 'function' object has no attribute 'parse_obj'` means you have v1 code on v2. Check with `pydantic.VERSION`.

**Using `requests` in async code** — `requests` is synchronous and blocks the event loop. Use `httpx.AsyncClient` for async code. If you must use synchronous code, run it in a thread pool: `await asyncio.get_event_loop().run_in_executor(None, sync_fn)`.

**Not awaiting `aclose()` on the httpx client** — leaking an `httpx.AsyncClient` produces a `ResourceWarning` and can cause connection pool exhaustion. Always use `async with httpx.AsyncClient()` or call `await client.aclose()` in a `finally` block.

**Hardcoding `localhost:3100`** — inside Docker, `localhost` refers to the current container, not the MCP server. Use `http://mcp-server:3100`. Read from `MCP_SERVER_URL` env var so the same code works in both Docker and local testing.

**Modifying `worker.py` core logic directly** — the RAG worker is shared infrastructure. Adding custom processing inline makes upgrades difficult and breaks other projects. Use the `BaseProcessor` extension point and register processors by MIME type so the core worker remains unchanged.
