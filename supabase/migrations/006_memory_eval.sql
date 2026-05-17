-- ═══════════════════════════════════════════════════════════
-- 006: Agent memory — persistent key-value store
-- Structured state that survives across sessions.
-- Keys are namespaced strings, values are JSONB.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS memories (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  metadata    jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TRIGGER trg_memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Eval results table for search quality tracking ──────
CREATE TABLE IF NOT EXISTS eval_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_set_name  text NOT NULL,
  results         jsonb NOT NULL,
  summary         jsonb NOT NULL,
  created_at      timestamptz DEFAULT now()
);
