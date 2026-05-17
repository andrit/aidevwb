-- ═══════════════════════════════════════════════════════════
-- 003: Document chunks — vector embeddings + full-text search
-- vector(1024) matches Voyage voyage-3 default dimensions.
-- If you swap models, ALTER this column + run /reindex.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS document_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid REFERENCES documents(id) ON DELETE CASCADE,
  content         text NOT NULL,
  embedding       vector(1024),
  search_vector   tsvector,
  chunk_index     integer,
  metadata        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now()
);

-- Vector similarity index (IVFFlat)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Full-text search index (GIN)
CREATE INDEX IF NOT EXISTS idx_chunks_search_vector
  ON document_chunks USING gin (search_vector);

-- Foreign key lookup
CREATE INDEX IF NOT EXISTS idx_chunks_document_id
  ON document_chunks(document_id);

-- Auto-populate tsvector on insert/update
CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_search_vector
  BEFORE INSERT OR UPDATE ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION update_search_vector();
