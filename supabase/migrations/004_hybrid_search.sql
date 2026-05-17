-- ═══════════════════════════════════════════════════════════
-- 004: Hybrid search function
-- Combines cosine similarity (semantic) + ts_rank (keyword)
-- with configurable weights. Default: 70% vector, 30% text.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION hybrid_search(
  query_embedding   vector(1024),
  query_text        text,
  match_threshold   float DEFAULT 0.5,
  match_count       int DEFAULT 5,
  vector_weight     float DEFAULT 0.7,
  text_weight       float DEFAULT 0.3
)
RETURNS TABLE (
  id              uuid,
  document_id     uuid,
  content         text,
  metadata        jsonb,
  similarity      float,
  text_rank       float,
  hybrid_score    float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.content,
    dc.metadata,
    (1 - (dc.embedding <=> query_embedding))::float AS similarity,
    ts_rank(dc.search_vector, plainto_tsquery('english', query_text))::float
      AS text_rank,
    (
      vector_weight * (1 - (dc.embedding <=> query_embedding)) +
      text_weight * ts_rank(dc.search_vector, plainto_tsquery('english', query_text))
    )::float AS hybrid_score
  FROM document_chunks dc
  WHERE (1 - (dc.embedding <=> query_embedding)) > match_threshold
     OR ts_rank(dc.search_vector, plainto_tsquery('english', query_text)) > 0.01
  ORDER BY (
    vector_weight * (1 - (dc.embedding <=> query_embedding)) +
    text_weight * ts_rank(dc.search_vector, plainto_tsquery('english', query_text))
  ) DESC
  LIMIT match_count;
END;
$$;
