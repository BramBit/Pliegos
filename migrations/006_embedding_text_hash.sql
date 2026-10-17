ALTER TABLE opportunity_embeddings
  ADD COLUMN IF NOT EXISTS text_hash TEXT;
