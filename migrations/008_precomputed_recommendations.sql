CREATE TABLE IF NOT EXISTS profile_embeddings (
  profile_id VARCHAR(255) PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  text_hash TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding vector(768) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recommendation_runs (
  id VARCHAR(255) PRIMARY KEY,
  profile_id VARCHAR(255) NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  candidates INT NOT NULL DEFAULT 0,
  kept INT NOT NULL DEFAULT 0,
  level TEXT NOT NULL,
  degraded BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_recommendation_runs_profile_finished
  ON recommendation_runs (profile_id, finished_at DESC);
