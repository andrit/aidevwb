"""
Configuration — mirrors the TS config for consistency.
"""
import os

ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")

OPENROUTER_API_KEY = os.environ["OPENROUTER_API_KEY"]
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "voyage/voyage-3")
EMBEDDING_DIMENSIONS = int(os.environ.get("EMBEDDING_DIMENSIONS", "1024"))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "http://supabase-kong:8000")
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
SUPABASE_DB_URL = os.environ.get(
    "SUPABASE_DB_URL",
    "postgresql://postgres:postgres@supabase-db:5432/postgres"
)

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379")

CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
