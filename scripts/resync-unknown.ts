import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  SecopAdapter,
  RawSecopProcess,
} from '../src/modules/opportunity/infrastructure/adapters/secop/secop.adapter';
import { PostgresOpportunityRepository } from '../src/modules/opportunity/infrastructure/adapters/persistence/postgres-opportunity.repository';
import { Opportunity } from '../src/modules/opportunity/domain/entities/opportunity.entity';
import {
  asOpportunityId,
  OpportunityId,
} from '../src/modules/shared/domain/typed-id';

export interface ResyncUnknownResult {
  totalProcessed: number;
  updated: number;
  stillUnknown: number;
  histogram: Record<string, number>;
}

export async function resyncUnknownOpportunities(
  pool: Pool,
  adapter: {
    fetchRawByIds: (ids: string[]) => Promise<RawSecopProcess[]>;
    mapToOpportunity: (raw: RawSecopProcess, id?: OpportunityId) => any;
  },
  batchSize: number = 100,
): Promise<ResyncUnknownResult> {
  const repo = new PostgresOpportunityRepository(pool);
  const rowsRes = await pool.query<{ id: string; source_external_id: string }>(
    "SELECT id, source_external_id FROM opportunities WHERE status = 'Unknown' ORDER BY source_external_id ASC;",
  );

  const oppMap = new Map(rowsRes.rows.map((r) => [r.source_external_id, r.id]));
  const ids = rowsRes.rows.map((r) => r.source_external_id);
  const histogram: Record<string, number> = {};
  let totalProcessed = 0;
  let updated = 0;
  let stillUnknown = 0;

  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    const rawItems = await adapter.fetchRawByIds(chunk);
    const toSave: Opportunity[] = [];

    for (const raw of rawItems) {
      const existingId = oppMap.get(raw.id_del_proceso);
      const oppId = asOpportunityId(existingId ?? randomUUID());
      const oppResult = adapter.mapToOpportunity(raw, oppId);
      if (oppResult.ok) {
        const opp = oppResult.value;
        toSave.push(opp);
        totalProcessed++;
        if (opp.status === 'Unknown') {
          stillUnknown++;
          const statusKey = opp.sourceStatus ?? 'null';
          histogram[statusKey] = (histogram[statusKey] ?? 0) + 1;
        } else {
          updated++;
        }
      }
    }

    if (toSave.length > 0) {
      await repo.saveMany(toSave);
    }
  }

  return { totalProcessed, updated, stillUnknown, histogram };
}

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
  const adapter = new SecopAdapter({
    appToken: process.env.SECOP_APP_TOKEN,
  });

  try {
    console.log(
      'Starting resync of Unknown status opportunities from SECOP...',
    );
    const result = await resyncUnknownOpportunities(pool, adapter, 100);

    console.log(`\nResync complete:`);
    console.log(`  Total processed from SECOP: ${result.totalProcessed}`);
    console.log(`  Successfully mapped to known status: ${result.updated}`);
    console.log(`  Still Unknown: ${result.stillUnknown}`);

    console.log(`\nHistogram of source_status for still-Unknown rows:`);
    const entries = Object.entries(result.histogram).sort(
      (a, b) => b[1] - a[1],
    );
    if (entries.length === 0) {
      console.log('  (none - all resolved)');
    } else {
      for (const [status, count] of entries) {
        console.log(`  "${status}": ${count}`);
      }
    }
  } finally {
    await pool.end();
  }
}

if (
  require.main === module ||
  (process.argv[1] && process.argv[1].includes('resync-unknown'))
) {
  main().catch((err) => {
    console.error('Resync failed:', err);
    process.exit(1);
  });
}
