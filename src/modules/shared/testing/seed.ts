import { Pool } from 'pg';

/**
 * Test-only helpers. They insert the minimal parent rows that the real schema's
 * foreign keys require (recommendations and alerts reference profiles and
 * opportunities). Safe to call repeatedly.
 */
export async function seedProfile(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO profiles (id, owner_id, sector) VALUES ($1, 'test-owner', 'test-sector')
     ON CONFLICT (id) DO NOTHING`,
    [id],
  );
}

export async function seedOpportunity(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO opportunities (
       id, title, contracting_entity_name, contracting_entity_tax_id, amount, contract_type,
       procurement_modality, category_code, published_at, status, source_name,
       source_external_id, source_human_reference, source_original_url
     ) VALUES ($1, 'test', 'test', '0', 0, 'test', 'test', 'test', now(), 'Published', 'TEST',
               $1, $1, 'http://localhost/test')
     ON CONFLICT (id) DO NOTHING`,
    [id],
  );
}
