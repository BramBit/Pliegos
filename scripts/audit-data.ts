/**
 * Read-only data quality audit. Prints counts and percentages only; it does not
 * interpret them. Usage: pnpm audit:data (reads DATABASE_URL).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';

function pct(part: number, total: number): string {
  return total === 0 ? 'n/a' : `${((part / total) * 100).toFixed(2)}%`;
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

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

  const pool = new Pool({ connectionString: databaseUrl });
  const num = async (sql: string): Promise<number> =>
    Number((await pool.query<{ n: string }>(sql)).rows[0].n);

  try {
    const total = await num('SELECT count(*) AS n FROM opportunities');

    section('1. Totals');
    console.log(`total opportunities: ${total}`);
    for (const [label, column] of [
      ['status', 'status'],
      ['procurement_modality', 'procurement_modality'],
      ['is_open_for_submission', 'is_open_for_submission'],
    ] as const) {
      console.log(`\nby ${label}:`);
      const { rows } = await pool.query<{ value: string; n: string }>(
        `SELECT ${column}::text AS value, count(*) AS n FROM opportunities GROUP BY 1 ORDER BY 2 DESC`,
      );
      for (const row of rows) {
        console.log(`  ${row.value}: ${row.n} (${pct(Number(row.n), total)})`);
      }
    }

    section('2. category_code');
    console.log('top 15 values:');
    const categories = await pool.query<{ value: string; n: string }>(
      `SELECT category_code AS value, count(*) AS n FROM opportunities GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
    );
    for (const row of categories.rows) {
      console.log(`  ${row.value}: ${row.n} (${pct(Number(row.n), total)})`);
    }
    const unspecified = await num(
      `SELECT count(*) AS n FROM opportunities WHERE category_code IN ('UNSPECIFIED', 'V1.00000000')`,
    );
    console.log(`UNSPECIFIED or V1.00000000: ${unspecified} (${pct(unspecified, total)})`);

    section('3. closing_date NULL, by modality');
    const closing = await pool.query<{ value: string; total: string; nulls: string }>(
      `SELECT procurement_modality AS value, count(*) AS total,
              count(*) FILTER (WHERE closing_date IS NULL) AS nulls
       FROM opportunities GROUP BY 1 ORDER BY 2 DESC`,
    );
    const nullClosing = await num('SELECT count(*) AS n FROM opportunities WHERE closing_date IS NULL');
    console.log(`overall closing_date NULL: ${nullClosing} (${pct(nullClosing, total)})`);
    for (const row of closing.rows) {
      console.log(
        `  ${row.value}: ${row.nulls}/${row.total} (${pct(Number(row.nulls), Number(row.total))})`,
      );
    }

    section("4. department / city placeholders ('No Definido', 'No Aplica', empty)");
    for (const column of ['department', 'city']) {
      const placeholders = await num(
        `SELECT count(*) AS n FROM opportunities WHERE ${column} IN ('No Definido', 'No Aplica')`,
      );
      const empty = await num(
        `SELECT count(*) AS n FROM opportunities WHERE ${column} IS NOT NULL AND btrim(${column}) = ''`,
      );
      const nulls = await num(`SELECT count(*) AS n FROM opportunities WHERE ${column} IS NULL`);
      console.log(`${column}:`);
      console.log(`  'No Definido' or 'No Aplica': ${placeholders} (${pct(placeholders, total)})`);
      console.log(`  empty string: ${empty} (${pct(empty, total)})`);
      console.log(`  NULL: ${nulls} (${pct(nulls, total)})`);
    }

    section('5. amount = 0');
    const zeroAmount = await num('SELECT count(*) AS n FROM opportunities WHERE amount = 0');
    console.log(`amount = 0: ${zeroAmount} (${pct(zeroAmount, total)})`);

    section('6. published_at');
    const range = await pool.query<{ min: Date | null; max: Date | null }>(
      'SELECT min(published_at) AS min, max(published_at) AS max FROM opportunities',
    );
    console.log(`min: ${range.rows[0].min?.toISOString() ?? 'n/a'}`);
    console.log(`max: ${range.rows[0].max?.toISOString() ?? 'n/a'}`);
    console.log('count per month:');
    const months = await pool.query<{ month: string; n: string }>(
      `SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, count(*) AS n
       FROM opportunities GROUP BY 1 ORDER BY 1`,
    );
    for (const row of months.rows) {
      console.log(`  ${row.month}: ${row.n}`);
    }

    section('7. Repeated (contracting_entity_name, title) pairs');
    const repeatedPairs = await num(
      `SELECT count(*) AS n FROM (
         SELECT 1 FROM opportunities GROUP BY contracting_entity_name, title HAVING count(*) > 1
       ) t`,
    );
    console.log(`pairs appearing more than once: ${repeatedPairs}`);

    section('8. Analysis and embeddings');
    const withoutAnalysis = await num('SELECT count(*) AS n FROM opportunities WHERE analysis IS NULL');
    console.log(`without analysis: ${withoutAnalysis} (${pct(withoutAnalysis, total)})`);
    const embeddings = await num('SELECT count(*) AS n FROM opportunity_embeddings');
    console.log(`rows in opportunity_embeddings: ${embeddings}`);
    const unknownStatus = await num("SELECT count(*) AS n FROM opportunities WHERE status = 'Unknown'");
    console.log(`status = 'Unknown': ${unknownStatus} (${pct(unknownStatus, total)})`);

    section('9. Coverage of recommendable rows');
    const cov = await pool.query<{
      recommendable: string;
      with_emb: string;
      with_desc: string;
      with_cat: string;
      with_dept: string;
      with_amount: string;
      with_future_closing: string;
    }>(`
      WITH a AS (
        SELECT o.*, (e.opportunity_id IS NOT NULL) AS has_emb
        FROM opportunities o
        LEFT JOIN opportunity_embeddings e ON e.opportunity_id = o.id
        WHERE o.is_competitive
          AND o.status IN ('Published', 'Amended')
          AND (o.closing_date IS NULL OR o.closing_date >= now() - interval '7 days')
      )
      SELECT
        count(*) AS recommendable,
        count(*) FILTER (WHERE has_emb) AS with_emb,
        count(*) FILTER (WHERE length(btrim(description)) > 0) AS with_desc,
        count(*) FILTER (WHERE category_code IS NOT NULL AND upper(category_code) <> 'UNSPECIFIED'
                          AND regexp_replace(category_code, '^V1\\.', '') !~ '^0+$') AS with_cat,
        count(*) FILTER (WHERE department IS NOT NULL AND department NOT IN ('No Definido', 'No Aplica') AND btrim(department) <> '') AS with_dept,
        count(*) FILTER (WHERE amount_known AND amount > 0) AS with_amount,
        count(*) FILTER (WHERE closing_date >= now()) AS with_future_closing
      FROM a;
    `);

    const r = cov.rows[0];
    const recTotal = Number(r.recommendable);
    console.log(`total recommendable: ${recTotal}`);
    console.log(`with embedding: ${r.with_emb} (${pct(Number(r.with_emb), recTotal)})`);
    console.log(`with description: ${r.with_desc} (${pct(Number(r.with_desc), recTotal)})`);
    console.log(`with valid category: ${r.with_cat} (${pct(Number(r.with_cat), recTotal)})`);
    console.log(`with department: ${r.with_dept} (${pct(Number(r.with_dept), recTotal)})`);
    console.log(`with known amount: ${r.with_amount} (${pct(Number(r.with_amount), recTotal)})`);
    console.log(`with future closing date: ${r.with_future_closing} (${pct(Number(r.with_future_closing), recTotal)})`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
