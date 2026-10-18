CREATE TABLE IF NOT EXISTS watches (
  profile_id VARCHAR(255) NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  opportunity_id VARCHAR(255) NOT NULL REFERENCES opportunities (id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (profile_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_watches_opportunity_id ON watches (opportunity_id);
