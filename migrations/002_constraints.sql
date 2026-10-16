-- 1. Remove orphan rows so the foreign keys can be created.
DELETE FROM recommendations r
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = r.profile_id)
   OR NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.id = r.opportunity_id);

DELETE FROM alerts a
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = a.profile_id);

DELETE FROM opportunity_embeddings e
WHERE NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.id = e.opportunity_id);

-- 2. Remove duplicates, keeping the newest recommendation per profile + opportunity.
DELETE FROM recommendations r
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY profile_id, opportunity_id
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM recommendations
) d
WHERE r.id = d.id AND d.rn > 1;

-- 3. Constraints.
ALTER TABLE recommendations
  ADD CONSTRAINT uq_recommendations_profile_opportunity UNIQUE (profile_id, opportunity_id);

ALTER TABLE recommendations
  ADD CONSTRAINT fk_recommendations_profile
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE;

ALTER TABLE recommendations
  ADD CONSTRAINT fk_recommendations_opportunity
  FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE;

ALTER TABLE alerts
  ADD CONSTRAINT fk_alerts_profile
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE;

ALTER TABLE opportunity_embeddings
  ADD CONSTRAINT fk_opportunity_embeddings_opportunity
  FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE CASCADE;

-- 4. Indexes.
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities (status);
CREATE INDEX IF NOT EXISTS idx_opportunities_closing_date ON opportunities (closing_date);
CREATE INDEX IF NOT EXISTS idx_opportunities_published_at ON opportunities (published_at DESC);
