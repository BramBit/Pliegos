ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_competitive BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS amount_known BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE opportunities
  ALTER COLUMN category_code DROP NOT NULL;

UPDATE opportunities
SET last_published_at = published_at
WHERE last_published_at IS NULL;

UPDATE opportunities
SET is_competitive = CASE
  WHEN translate(lower(btrim(coalesce(procurement_modality, ''))), 'áéíóú', 'aeiou') LIKE 'contratacion directa%' THEN FALSE
  WHEN translate(lower(btrim(coalesce(procurement_modality, ''))), 'áéíóú', 'aeiou') = 'contratacion regimen especial' THEN FALSE
  ELSE TRUE
END;
