import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { Profile } from '../src/modules/profile/domain/entities/profile.entity';
import { asProfileId, asUserId, OpportunityId } from '../src/modules/shared/domain/typed-id';
import { PostgresOpportunityRepository } from '../src/modules/opportunity/infrastructure/adapters/persistence/postgres-opportunity.repository';
import { OllamaAdapter } from '../src/modules/recommendation/infrastructure/adapters/ollama/ollama.adapter';
import { MatchingService } from '../src/modules/recommendation/domain/services/matching.service';
import { Opportunity } from '../src/modules/opportunity/domain/entities/opportunity.entity';

export interface EvalCandidate {
  id: string;
  title: string;
  description: string;
  entity: string;
  department: string | null;
  amount: number;
  modality: string;
  closingDate: string | null;
}

const TOP_COUNT = 30;
const RANDOM_COUNT = 30;

function seededShuffle<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let state = seed >>> 0;
  const nextRand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function toEvalCandidate(opp: Opportunity): EvalCandidate {
  return {
    id: opp.id,
    title: opp.title,
    description: (opp.description ?? '').slice(0, 400),
    entity: opp.contractingEntity.name,
    department: opp.location.department,
    amount: opp.amount.amount,
    modality: opp.procurementModality,
    closingDate: opp.closingDate ? opp.closingDate.toISOString() : null,
  };
}

async function main() {
  const rootDir = path.resolve(__dirname, '../..');
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
  const env = loadEnv();
  const profilesPath = path.join(rootDir, 'eval', 'profiles.json');
  const candidatesOutPath = path.join(rootDir, 'eval', 'candidates.json');

  const rawProfiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8')) as Array<{
    id: string;
    ownerId: string;
    sector: string;
    capabilities: Array<{ name: string; yearsOfExperience: number }>;
    preferences: {
      categoryCodes: string[];
      keywords: string[];
      amountRange: { min: number; max: number } | null;
      departments: string[];
    };
  }>;

  const profiles: Profile[] = rawProfiles.map((p) => ({
    id: asProfileId(p.id),
    ownerId: asUserId(p.ownerId),
    sector: p.sector,
    capabilities: p.capabilities,
    preferences: p.preferences,
  }));

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const repo = new PostgresOpportunityRepository(pool);
    const ai = new OllamaAdapter({
      baseUrl: env.OLLAMA_BASE_URL,
      embedModel: env.OLLAMA_EMBED_MODEL,
      chatModel: env.OLLAMA_CHAT_MODEL,
      embedTimeoutMs: env.OLLAMA_EMBED_TIMEOUT_MS,
      chatTimeoutMs: env.OLLAMA_CHAT_TIMEOUT_MS,
    });
    const matching = new MatchingService();

    // Fetch actionable opportunities that have embeddings and descriptions
    let { rows } = await pool.query<{ id: string }>(
      `SELECT o.id
       FROM opportunities o
       JOIN opportunity_embeddings e ON e.opportunity_id = o.id
       WHERE o.status IN ('Published', 'Amended')
         AND (o.closing_date IS NULL OR o.closing_date >= NOW())
         AND o.description <> ''
       ORDER BY o.published_at DESC
       LIMIT 1000`,
    );

    if (rows.length < TOP_COUNT + RANDOM_COUNT) {
      const fallback = await pool.query<{ id: string }>(
        `SELECT o.id
         FROM opportunities o
         JOIN opportunity_embeddings e ON e.opportunity_id = o.id
         WHERE o.status IN ('Published', 'Amended')
           AND (o.closing_date IS NULL OR o.closing_date >= NOW())
         ORDER BY (o.description <> '') DESC, o.published_at DESC
         LIMIT 1000`,
      );
      rows = fallback.rows;
    }

    const loaded = await Promise.all(rows.map((r) => repo.findById(r.id as OpportunityId)));
    const actionable = loaded.filter((o): o is Opportunity => o !== null);

    console.log(`actionable_pool=${actionable.length}`);

    const output: Record<string, EvalCandidate[]> = {};

    for (let idx = 0; idx < profiles.length; idx++) {
      const profile = profiles[idx];
      const [profileVec] = await ai.embed([MatchingService.buildProfileText(profile)]);
      const sims = await pool.query<{ id: string; cos: number }>(
        `SELECT opportunity_id AS id, 1 - (embedding <=> $1::vector) AS cos
         FROM opportunity_embeddings
         WHERE opportunity_id = ANY($2::text[])
           AND embedding_model = $3`,
        [`[${profileVec.join(',')}]`, actionable.map((c) => c.id), ai.model],
      );
      const cosById = new Map(sims.rows.map((r) => [r.id, Number(r.cos)]));

      const scored: Array<{ opp: Opportunity; score: number }> = [];
      for (const opp of actionable) {
        const rawCos = cosById.get(opp.id);
        const semantic = rawCos !== undefined ? MatchingService.normalizeCosine(rawCos) : null;
        const breakdown = await matching.computeBreakdown(opp, profile, semantic);
        scored.push({ opp, score: breakdown.combinedScore });
      }

      scored.sort((a, b) => b.score - a.score || a.opp.id.localeCompare(b.opp.id));

      const top30 = scored.slice(0, TOP_COUNT).map((s) => s.opp);
      const topIds = new Set(top30.map((o) => o.id));
      const remaining = scored.slice(TOP_COUNT).map((s) => s.opp).filter((o) => !topIds.has(o.id));
      const random30 = seededShuffle(remaining, 20261017 + idx).slice(0, RANDOM_COUNT);

      const combined = [...top30, ...random30].map(toEvalCandidate);
      output[profile.id] = combined;

      console.log(
        `profile=${profile.id} top=${top30.length} random=${random30.length} total=${combined.length}`,
      );
    }

    fs.mkdirSync(path.dirname(candidatesOutPath), { recursive: true });
    fs.writeFileSync(candidatesOutPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
