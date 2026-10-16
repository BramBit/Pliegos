DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
  WHEN unique_violation THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS opportunities (
  id VARCHAR(255) PRIMARY KEY,
  title TEXT NOT NULL,
  contracting_entity_name TEXT NOT NULL,
  contracting_entity_tax_id TEXT NOT NULL,
  city VARCHAR(255),
  department VARCHAR(255),
  amount NUMERIC NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'COP',
  contract_type VARCHAR(255) NOT NULL,
  procurement_modality VARCHAR(255) NOT NULL,
  category_code VARCHAR(100) NOT NULL,
  published_at TIMESTAMP WITH TIME ZONE NOT NULL,
  closing_date TIMESTAMP WITH TIME ZONE,
  is_open_for_submission BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(50) NOT NULL,
  source_name VARCHAR(50) NOT NULL,
  source_external_id VARCHAR(255) NOT NULL UNIQUE,
  source_human_reference VARCHAR(255) NOT NULL,
  source_original_url TEXT NOT NULL,
  analysis JSONB,
  change_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_opportunities_external_id ON opportunities (source_external_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_category ON opportunities (category_code);
CREATE INDEX IF NOT EXISTS idx_opportunities_department ON opportunities (department);

CREATE TABLE IF NOT EXISTS profiles (
  id VARCHAR(255) PRIMARY KEY,
  owner_id VARCHAR(255) NOT NULL,
  sector TEXT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recommendations (
  id VARCHAR(255) PRIMARY KEY,
  profile_id VARCHAR(255) NOT NULL,
  opportunity_id VARCHAR(255) NOT NULL,
  score NUMERIC NOT NULL,
  explanation JSONB NOT NULL,
  feedback JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recommendations_profile ON recommendations (profile_id);

CREATE TABLE IF NOT EXISTS alerts (
  id VARCHAR(255) PRIMARY KEY,
  profile_id VARCHAR(255) NOT NULL,
  opportunity_id VARCHAR(255) NOT NULL,
  trigger VARCHAR(100) NOT NULL,
  delivered_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_delivered ON alerts (delivered_at);

CREATE TABLE IF NOT EXISTS opportunity_embeddings (
  opportunity_id VARCHAR(255) PRIMARY KEY,
  category_code VARCHAR(100),
  department VARCHAR(100),
  contract_type VARCHAR(100),
  amount NUMERIC,
  embedding vector(768) NOT NULL,
  indexed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_opportunity_embeddings_vector
ON opportunity_embeddings USING hnsw (embedding vector_cosine_ops);
