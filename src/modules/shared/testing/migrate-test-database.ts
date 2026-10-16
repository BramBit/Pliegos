import * as path from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from '../infrastructure/persistence/migrator';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../migrations');

/**
 * Test-only helper. Brings the test database to the real schema by running
 * the versioned migrations (idempotent and serialized by an advisory lock, so
 * Jest workers can call it concurrently).
 */
export async function migrateTestDatabase(pool: Pool): Promise<void> {
  await runMigrations(pool, MIGRATIONS_DIR);
}
