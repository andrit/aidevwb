/**
 * Configuration — single source of truth for all providers and settings.
 *
 * LLM:        Anthropic Claude SDK (direct, no proxy)
 * Embeddings: OpenRouter proxy (swap models via EMBEDDING_MODEL env)
 * Database:   Direct PostgreSQL (multi-database, one per project)
 * Queue:      Redis via BullMQ
 */

export const config = {
  // ── LLM ────────────────────────────────────────────────
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  claudeModel: env("CLAUDE_MODEL", "claude-sonnet-4-20250514"),

  // ── Embeddings ─────────────────────────────────────────
  openrouterApiKey: env("OPENROUTER_API_KEY"),
  embeddingModel: env("EMBEDDING_MODEL", "voyage/voyage-3"),
  embeddingDimensions: parseInt(env("EMBEDDING_DIMENSIONS", "1024")),

  // ── PostgreSQL (direct, not through PostgREST) ─────────
  pgHost: env("PG_HOST", "supabase-db"),
  pgPort: parseInt(env("PG_PORT", "5432")),
  pgUser: env("PG_USER", "postgres"),
  pgPassword: env("PG_PASSWORD", env("POSTGRES_PASSWORD", "")),
  pgRegistryDb: env("PG_REGISTRY_DB", "workbench"),

  // ── Redis ──────────────────────────────────────────────
  redisUrl: env("REDIS_URL", "redis://redis:6379"),

  // ── Ingestion ──────────────────────────────────────────
  chunkSize: 500,
  chunkOverlap: 50,

  // ── Search ─────────────────────────────────────────────
  vectorWeight: 0.7,
  textWeight: 0.3,
  matchThreshold: 0.5,
  matchCount: 5,

  // ── Server ─────────────────────────────────────────────
  port: parseInt(env("PORT", "3100")),
} as const;

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
