ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_opportunities_search_tsv
  ON opportunities USING GIN (search_tsv);

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET hnsw.iterative_scan = %L', current_database(), 'relaxed_order');
  EXECUTE format('ALTER DATABASE %I SET random_page_cost = 1.0', current_database());
  EXECUTE format('ALTER DATABASE %I SET cpu_index_tuple_cost = 0.0001', current_database());
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
