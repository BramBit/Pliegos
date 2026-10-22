import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrator';
import { requireTestDatabaseUrl } from '../../testing/test-database-url';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../../migrations');

describe('runMigrations (integration, real Postgres)', () => {
  const baseUrl = requireTestDatabaseUrl();
  const scratchName = `pliegos_migrate_${process.pid}_${Date.now()}`;
  let adminPool: Pool;
  let pool: Pool;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: baseUrl });
    await adminPool.query(`CREATE DATABASE ${scratchName}`);

    const scratchUrl = new URL(baseUrl);
    scratchUrl.pathname = `/${scratchName}`;
    pool = new Pool({ connectionString: scratchUrl.toString() });
  });

  afterAll(async () => {
    await pool.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${scratchName}`);
    await adminPool.end();
  });

  it('applies every migration on an empty database, then applies none on the second run', async () => {
    const first = await runMigrations(pool, MIGRATIONS_DIR);
    expect(first.applied.length).toBeGreaterThanOrEqual(2);
    expect(first.applied).toEqual([...first.applied].sort());
    expect(first.skipped).toEqual([]);

    const second = await runMigrations(pool, MIGRATIONS_DIR);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(first.applied);

    const { rows } = await pool.query(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(rows.map((row) => row.version)).toEqual(first.applied);
  });

  it('creates the unique constraint and the cascading foreign keys', async () => {
    const { rows } = await pool.query<{ conname: string; confdeltype: string }>(
      `SELECT conname, confdeltype FROM pg_constraint
       WHERE conname IN (
         'uq_recommendations_profile_opportunity',
         'fk_recommendations_profile',
         'fk_recommendations_opportunity',
         'fk_alerts_profile',
         'fk_opportunity_embeddings_opportunity'
       )`,
    );
    expect(rows).toHaveLength(5);
    for (const row of rows.filter((r) => r.conname.startsWith('fk_'))) {
      expect(row.confdeltype).toBe('c');
    }
  });

  it('rolls back a failing migration and does not record it', async () => {
    const tmpDir = path.join(os.tmpdir(), `mig_${Date.now()}`);
    fs.mkdirSync(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '900_bad.sql'),
      'CREATE TABLE t_ok (id int); SELECT * FROM missing_table;',
    );

    await expect(runMigrations(pool, tmpDir)).rejects.toThrow('900_bad.sql');

    const table = await pool.query(`SELECT to_regclass('t_ok') AS name`);
    expect(table.rows[0].name).toBeNull();
    const recorded = await pool.query(
      `SELECT 1 FROM schema_migrations WHERE version = '900_bad.sql'`,
    );
    expect(recorded.rowCount).toBe(0);
  });

  it('deduplicates and removes orphans when migration 002 runs over dirty data', async () => {
    const dirtyName = `${scratchName}_dirty`;
    await adminPool.query(`CREATE DATABASE ${dirtyName}`);
    const dirtyUrl = new URL(baseUrl);
    dirtyUrl.pathname = `/${dirtyName}`;
    const dirtyPool = new Pool({ connectionString: dirtyUrl.toString() });
    try {
      const onlyFirst = path.join(os.tmpdir(), `mig_first_${Date.now()}`);
      fs.mkdirSync(onlyFirst);
      fs.copyFileSync(
        path.join(MIGRATIONS_DIR, '001_init.sql'),
        path.join(onlyFirst, '001_init.sql'),
      );
      await runMigrations(dirtyPool, onlyFirst);

      await dirtyPool.query(`
        INSERT INTO profiles (id, owner_id, sector) VALUES ('p1', 'u1', 'tech');
        INSERT INTO opportunities (id, title, contracting_entity_name, contracting_entity_tax_id, amount,
          contract_type, procurement_modality, category_code, published_at, status, source_name,
          source_external_id, source_human_reference, source_original_url)
        VALUES ('o1', 't', 'e', '1', 1, 'c', 'm', 'x', now(), 'Published', 's', 'ext1', 'ref', 'http://x');
        INSERT INTO recommendations (id, profile_id, opportunity_id, score, explanation, updated_at)
          VALUES ('r_old', 'p1', 'o1', 0.5, '{}', now() - interval '1 day'),
                 ('r_new', 'p1', 'o1', 0.6, '{}', now()),
                 ('r_orphan_profile', 'ghost', 'o1', 0.5, '{}', now()),
                 ('r_orphan_opp', 'p1', 'ghost', 0.5, '{}', now());
        INSERT INTO alerts (id, profile_id, opportunity_id, trigger) VALUES ('a1', 'ghost', 'o1', 'x');
      `);

      const result = await runMigrations(dirtyPool, MIGRATIONS_DIR);
      expect(result.applied).toContain('002_constraints.sql');

      const recs = await dirtyPool.query('SELECT id FROM recommendations');
      expect(recs.rows.map((r) => r.id)).toEqual(['r_new']);
      const alerts = await dirtyPool.query('SELECT 1 FROM alerts');
      expect(alerts.rowCount).toBe(0);

      await dirtyPool.query(`DELETE FROM profiles WHERE id = 'p1'`);
      const cascaded = await dirtyPool.query('SELECT 1 FROM recommendations');
      expect(cascaded.rowCount).toBe(0);
    } finally {
      await dirtyPool.end();
      await adminPool.query(`DROP DATABASE IF EXISTS ${dirtyName}`);
    }
  });
});
