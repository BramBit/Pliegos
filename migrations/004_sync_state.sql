CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  watermark TIMESTAMPTZ
);
