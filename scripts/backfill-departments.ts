import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { canonicalizeDepartment } from '../src/modules/shared/domain/colombian-departments';

async function main() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // 1. Copy department to department_raw when empty (idempotent)
    const copyRes = await pool.query(
      'UPDATE opportunities SET department_raw = department WHERE department_raw IS NULL AND department IS NOT NULL;',
    );
    console.log(`Initialized department_raw for ${copyRes.rowCount ?? 0} rows.`);

    // 2. Query distinct department_raw values
    const distinctRes = await pool.query<{ department_raw: string; count: string }>(
      'SELECT department_raw, COUNT(*)::text as count FROM opportunities WHERE department_raw IS NOT NULL GROUP BY department_raw ORDER BY count DESC;',
    );

    const canonicalCounts: Record<string, number> = {};
    const unmapped: Record<string, number> = {};

    for (const row of distinctRes.rows) {
      const raw = row.department_raw;
      const count = parseInt(row.count, 10);
      const canonical = canonicalizeDepartment(raw);

      if (canonical) {
        await pool.query(
          'UPDATE opportunities SET department = $1 WHERE department_raw = $2;',
          [canonical, raw],
        );
        canonicalCounts[canonical] = (canonicalCounts[canonical] ?? 0) + count;
      } else {
        unmapped[raw] = count;
      }
    }

    console.log('\n--- Canonical Departments Updated ---');
    const sortedCanonical = Object.entries(canonicalCounts).sort((a, b) => b[1] - a[1]);
    for (const [dept, cnt] of sortedCanonical) {
      console.log(`  ${dept}: ${cnt}`);
    }

    console.log('\n--- Unmapped Department Values ---');
    const sortedUnmapped = Object.entries(unmapped).sort((a, b) => b[1] - a[1]);
    if (sortedUnmapped.length === 0) {
      console.log('  (none)');
    } else {
      for (const [val, cnt] of sortedUnmapped) {
        console.log(`  "${val}": ${cnt}`);
      }
    }

    console.log('\nBackfill completed successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
