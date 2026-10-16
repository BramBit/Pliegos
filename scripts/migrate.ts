import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from '../src/modules/shared/infrastructure/persistence/migrator';

async function main() {
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const migrationsDir = path.resolve(__dirname, '../../migrations');
  console.log(`Migrating: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`);

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const { applied, skipped } = await runMigrations(pool, migrationsDir);
    for (const version of applied) console.log(`applied: ${version}`);
    for (const version of skipped) console.log(`skipped: ${version}`);
    console.log(`Done. applied=${applied.length} skipped=${skipped.length}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
