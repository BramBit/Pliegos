import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

// Arbitrary constant: serializes concurrent migrators on the same database.
const MIGRATION_LOCK_KEY = 727001;

/**
 * Applies every unapplied `*.sql` file of `migrationsDir` in filename order,
 * each one inside its own transaction. Applied versions are recorded in
 * `schema_migrations`; an applied migration is never re-run or edited.
 */
export async function runMigrations(pool: Pool, migrationsDir: string): Promise<MigrationResult> {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const alreadyApplied = new Set(rows.map((row) => row.version));

    for (const file of files) {
      if (alreadyApplied.has(file)) {
        result.skipped.push(file);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${file} failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      result.applied.push(file);
    }
    return result;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}
