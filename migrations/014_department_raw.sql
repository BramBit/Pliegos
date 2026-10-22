-- Migration 014: Store original raw department text before canonicalization
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS department_raw TEXT;
