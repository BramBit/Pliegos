import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Test-only helper. Reads TEST_DATABASE_URL explicitly (loading the project's
 * .env first, since Jest does not) and throws if it is not set. There is no
 * fallback database: tests never silently point at another database.
 */
export function requireTestDatabaseUrl(): string {
  const envPath = path.resolve(__dirname, '../../../../.env');
  if (!process.env.TEST_DATABASE_URL && fs.existsSync(envPath)) {
    // Jest sandboxes `process`, so process.loadEnvFile() would not be visible here.
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const match = /^\s*TEST_DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line);
      if (match) {
        process.env.TEST_DATABASE_URL = match[1];
        break;
      }
    }
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Define it in .env (see .env.example).');
  }
  return url;
}
