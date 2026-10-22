ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS match_tier SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS missing_criteria TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_recommendations_profile_tier_score
  ON recommendations (profile_id, match_tier ASC, score DESC);
