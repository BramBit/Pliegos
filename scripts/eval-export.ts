import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { Profile } from '../src/modules/profile/domain/entities/profile.entity';
import {
  asOpportunityId,
  asProfileId,
  asUserId,
} from '../src/modules/shared/domain/typed-id';
import { PostgresOpportunityRepository } from '../src/modules/opportunity/infrastructure/adapters/persistence/postgres-opportunity.repository';
import { OllamaAdapter } from '../src/modules/recommendation/infrastructure/adapters/ollama/ollama.adapter';
import { buildProfileQuery } from '../src/modules/recommendation/domain/services/matching.service';
import { buildProfileOrTsQuery } from '../src/modules/opportunity/domain/ports/search-index.port';
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
  const candidatesNewOutPath = path.join(
    rootDir,
    'eval',
    'candidates-new.json',
  );
  const labelsPath = path.join(rootDir, 'eval', 'labels.json');

  const rawProfiles = JSON.parse(
    fs.readFileSync(profilesPath, 'utf8'),
  ) as Array<{
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

  const allLabels: Record<string, Record<string, number>> = fs.existsSync(
    labelsPath,
  )
    ? JSON.parse(fs.readFileSync(labelsPath, 'utf8'))
    : {};

  let existingCandidates: Record<string, EvalCandidate[]> = {};
  if (fs.existsSync(candidatesOutPath)) {
    existingCandidates = JSON.parse(fs.readFileSync(candidatesOutPath, 'utf8'));
  }

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

    const candidatesNewOutput: Record<string, EvalCandidate[]> = {};

    for (const profile of profiles) {
      const profileLabels = allLabels[profile.id] ?? {};
      const labeledIds = Object.keys(profileLabels);

      // (a) Top 30 by full-text search using profile keywords (OR query)
      const ftsQuery = buildProfileOrTsQuery(profile.preferences.keywords);
      let ftsIds: string[] = [];
      if (ftsQuery) {
        const ftsRes = await pool.query<{ id: string }>(
          `SELECT o.id
           FROM opportunities o, to_tsquery('spanish', $1) AS q(tsq)
           WHERE o.search_tsv @@ q.tsq
             AND o.is_competitive = true
             AND o.status IN ('Published', 'Amended')
             AND (o.closing_date IS NULL OR o.closing_date >= NOW() - INTERVAL '7 days')
           ORDER BY ts_rank_cd(o.search_tsv, q.tsq) DESC, o.id ASC
           LIMIT 30;`,
          [ftsQuery],
        );
        ftsIds = ftsRes.rows.map((r) => r.id);
      }

      // (b) Top 30 by cosine similarity to the profile query vector
      const [profileVec] = await ai.embed([buildProfileQuery(profile)]);
      const vecRes = await pool.query<{ id: string }>(
        `SELECT o.id
         FROM opportunity_embeddings e
         JOIN opportunities o ON o.id = e.opportunity_id
         WHERE e.embedding_model = $1
           AND o.is_competitive = true
           AND o.status IN ('Published', 'Amended')
           AND (o.closing_date IS NULL OR o.closing_date >= NOW() - INTERVAL '7 days')
         ORDER BY e.embedding <=> $2::vector ASC, o.id ASC
         LIMIT 30;`,
        [ai.model, `[${profileVec.join(',')}]`],
      );
      const cosineIds = vecRes.rows.map((r) => r.id);

      // (c) 20 random recommendable rows
      const randomRes = await pool.query<{ id: string }>(
        `SELECT o.id
         FROM opportunities o
         WHERE o.is_competitive = true
           AND o.status IN ('Published', 'Amended')
           AND (o.closing_date IS NULL OR o.closing_date >= NOW() - INTERVAL '7 days')
         ORDER BY md5(o.id || $1)
         LIMIT 20;`,
        [profile.id],
      );
      const randomIds = randomRes.rows.map((r) => r.id);

      // (d) Every id already present in eval/labels.json for that profile
      const poolIds = Array.from(
        new Set([...ftsIds, ...cosineIds, ...randomIds, ...labeledIds]),
      );

      const profileCandidates = existingCandidates[profile.id] ?? [];
      const currentMap = new Map(profileCandidates.map((c) => [c.id, c]));

      const missingIds = poolIds.filter((id) => !currentMap.has(id));
      for (const id of missingIds) {
        const opp = await repo.findById(asOpportunityId(id));
        if (opp) {
          const cand = toEvalCandidate(opp);
          currentMap.set(cand.id, cand);
          profileCandidates.push(cand);
        }
      }

      existingCandidates[profile.id] = profileCandidates;

      const unlabeled = profileCandidates.filter(
        (cand) => profileLabels[cand.id] === undefined,
      );
      candidatesNewOutput[profile.id] = unlabeled;

      const poolSize = profileCandidates.length;
      const labeledCount = poolSize - unlabeled.length;
      const unlabeledCount = unlabeled.length;

      console.log(
        `profile=${profile.id}: pool=${poolSize}, labeled=${labeledCount}, unlabeled=${unlabeledCount}`,
      );
    }

    fs.mkdirSync(path.dirname(candidatesOutPath), { recursive: true });
    fs.writeFileSync(
      candidatesOutPath,
      JSON.stringify(existingCandidates, null, 2) + '\n',
      'utf8',
    );
    fs.writeFileSync(
      candidatesNewOutPath,
      JSON.stringify(candidatesNewOutput, null, 2) + '\n',
      'utf8',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
