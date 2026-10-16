import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { initDatabaseSchema } from '../src/modules/shared/infrastructure/persistence/database.schema';

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

async function initDb(url: string, label: string) {
  console.log(`Initializing ${label} schema on: ${url.replace(/:[^:@]+@/, ':****@')}`);
  const pool = new Pool({ connectionString: url });
  try {
    await initDatabaseSchema(pool);
    console.log(`✓ ${label} schema, tables, and pgvector extension initialized successfully.`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Error initializing ${label} schema: ${message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function run() {
  const primaryDb = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/pliegos';
  const testDb = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/pliegos_test';

  await initDb(primaryDb, 'Primary DB');
  if (testDb !== primaryDb) {
    await initDb(testDb, 'Test DB');
  }
}

run();

