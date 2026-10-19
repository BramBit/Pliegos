import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { hashPassword } from '../src/modules/auth/infrastructure/security/password-hasher';

async function main() {
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  const [emailArg, passwordArg] = process.argv.slice(2);

  if (!emailArg || !passwordArg) {
    console.error('Usage: node dist/scripts/create-admin.js <email> <password>');
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const password = passwordArg;

  if (password.length < 10) {
    console.error('Error: Password must be at least 10 characters long');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (lower(email))
       DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'
       RETURNING id, email, role, created_at;`,
      [email, passwordHash],
    );

    const user = result.rows[0];
    console.log(`Admin user ready: id=${user.id} email=${user.email} role=${user.role}`);
  } catch (err) {
    console.error('Failed to create admin user:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
