-- Migration 015: Repair legacy rows synced before plan and add source_status
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS source_status TEXT;

-- 1. Repair category codes
UPDATE opportunities
SET category_code = NULL
WHERE upper(coalesce(category_code, '')) = 'UNSPECIFIED'
   OR regexp_replace(coalesce(category_code, ''), '^V1\.', '') ~ '^0+$';

UPDATE opportunities
SET category_code = regexp_replace(category_code, '^V1\.', '')
WHERE category_code LIKE 'V1.%';

-- 2. Repair amount_known
UPDATE opportunities
SET amount_known = false
WHERE amount = 0;

-- 3. Repair placeholder locations
UPDATE opportunities
SET department = NULL
WHERE department IN ('No Definido', 'No Aplica');

UPDATE opportunities
SET city = NULL
WHERE city IN ('No Definido', 'No Aplica');
