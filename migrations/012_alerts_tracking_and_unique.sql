ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS change_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;

-- Deduplicate any existing alerts just in case before creating the unique constraint
DELETE FROM alerts a
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY profile_id, opportunity_id, trigger, change_key
           ORDER BY created_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM alerts
) d
WHERE a.id = d.id AND d.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_alerts_profile_opportunity_trigger_change_key'
  ) THEN
    ALTER TABLE alerts
      ADD CONSTRAINT uq_alerts_profile_opportunity_trigger_change_key
      UNIQUE (profile_id, opportunity_id, trigger, change_key);
  END IF;
END $$;
