import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { buildIndexText } from '../src/modules/opportunity/domain/entities/opportunity.entity';
import {
  PgVectorAdapter,
  computeIndexTextHash,
} from '../src/modules/opportunity/infrastructure/adapters/search/pgvector.adapter';
import { OllamaAdapter } from '../src/modules/recommendation/infrastructure/adapters/ollama/ollama.adapter';
import { asOpportunityId } from '../src/modules/shared/domain/typed-id';

const BATCH_SIZE = 32;

function parseLimitArg(args: string[]): number | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
    if (arg === '--limit' && i + 1 < args.length) {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return null;
}

interface CandidateRow {
  id: string;
  title: string;
  description: string | null;
  contracting_entity_name: string;
  contracting_entity_tax_id: string;
  contract_type: string;
  category_code: string | null;
  department: string | null;
  amount: string | number;
  existing_model: string | null;
  existing_text_hash: string | null;
}

async function main() {
  const rootDir = path.resolve(__dirname, '../..');
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
  const env = loadEnv();
  const limit = parseLimitArg(process.argv.slice(2));

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const embedder = new OllamaAdapter({
      baseUrl: env.OLLAMA_BASE_URL,
      embedModel: env.OLLAMA_EMBED_MODEL,
      chatModel: env.OLLAMA_CHAT_MODEL,
      embedTimeoutMs: env.OLLAMA_EMBED_TIMEOUT_MS,
      chatTimeoutMs: env.OLLAMA_CHAT_TIMEOUT_MS,
    });
    const pgVector = new PgVectorAdapter({ pool, embedder });

    const { rows } = await pool.query<CandidateRow>(`
      SELECT
        o.id,
        o.title,
        o.description,
        o.contracting_entity_name,
        o.contracting_entity_tax_id,
        o.contract_type,
        o.category_code,
        o.department,
        o.amount,
        e.embedding_model AS existing_model,
        e.text_hash AS existing_text_hash
      FROM opportunities o
      LEFT JOIN opportunity_embeddings e ON e.opportunity_id = o.id
      ORDER BY o.published_at DESC, o.id ASC
    `);

    const toReindex: Array<{
      row: CandidateRow;
      indexText: string;
      textHash: string;
    }> = [];
    let upToDateCount = 0;

    for (const row of rows) {
      const indexText = buildIndexText({
        title: row.title,
        description: row.description ?? '',
        contractingEntity: {
          name: row.contracting_entity_name,
          taxId: row.contracting_entity_tax_id,
        },
        contractType: row.contract_type,
      });
      const textHash = computeIndexTextHash(indexText);

      if (
        row.existing_model === embedder.model &&
        row.existing_text_hash === textHash
      ) {
        upToDateCount += 1;
        continue;
      }

      toReindex.push({ row, indexText, textHash });
    }

    const workItems = limit !== null ? toReindex.slice(0, limit) : toReindex;
    const totalBatches = Math.ceil(workItems.length / BATCH_SIZE);
    const totalStart = Date.now();
    let processed = 0;

    console.log(
      `[reindex] model=${embedder.model} totalRows=${rows.length} upToDate=${upToDateCount} pending=${toReindex.length} target=${workItems.length} batchSize=${BATCH_SIZE}`,
    );

    // Concurrency 1: process batches sequentially
    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batch = workItems.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
      const batchStart = Date.now();

      const vectors = await embedder.embed(batch.map((item) => item.indexText));

      for (let i = 0; i < batch.length; i++) {
        const { row, textHash } = batch[i];
        const vector = vectors[i];
        await pgVector.indexVector(asOpportunityId(row.id), vector, {
          categoryCode: row.category_code ?? undefined,
          department: row.department ?? undefined,
          contractType: row.contract_type,
          amount: Number(row.amount),
          embeddingModel: embedder.model,
          textHash,
        });
      }

      processed += batch.length;
      const batchDurationMs = Date.now() - batchStart;
      console.log(
        `[reindex] batch=${batchIdx + 1}/${totalBatches} processed=${processed}/${workItems.length} batchSize=${batch.length} durationMs=${batchDurationMs}`,
      );
    }

    const totalDurationMs = Date.now() - totalStart;
    console.log(
      `[reindex] done reindexed=${processed} upToDate=${upToDateCount} totalDurationMs=${totalDurationMs}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
