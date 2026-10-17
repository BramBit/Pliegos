ALTER TABLE opportunity_embeddings
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'nomic-embed-text';

CREATE INDEX IF NOT EXISTS idx_opportunity_embeddings_model
  ON opportunity_embeddings (embedding_model);
