"""
Configuration — mirrors the TS config for consistency.
"""
import os

ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
EMBEDDING_BASE_URL = os.environ.get("EMBEDDING_BASE_URL", "http://ollama:11434/v1")
EMBEDDING_API_KEY = os.environ.get("EMBEDDING_API_KEY", "ollama")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "mxbai-embed-large")
EMBEDDING_DIMENSIONS = int(os.environ.get("EMBEDDING_DIMENSIONS", "1024"))

DB_URL = os.environ.get(
    "SUPABASE_DB_URL",
    "postgresql://postgres:postgres@postgres:5432/postgres"
)

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379")

CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
