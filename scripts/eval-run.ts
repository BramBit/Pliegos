import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { Profile } from '../src/modules/profile/domain/entities/profile.entity';
import { asProfileId, asUserId, OpportunityId } from '../src/modules/shared/domain/typed-id';
import { PostgresOpportunityRepository } from '../src/modules/opportunity/infrastructure/adapters/persistence/postgres-opportunity.repository';
import { OllamaAdapter } from '../src/modules/recommendation/infrastructure/adapters/ollama/ollama.adapter';
import {
  MatchingService,
  ScoringBreakdown,
} from '../src/modules/recommendation/domain/services/matching.service';
import { Opportunity } from '../src/modules/opportunity/domain/entities/opportunity.entity';

type Grade = 0 | 1 | 2;
type ProfileLabels = Record<string, Grade>;
type AllLabels = Record<string, ProfileLabels>;

interface Thresholds {
  precisionAt10: number;
  ndcgAt10: number;
}

function precisionAtK(grades: Grade[], k: number): number {
  const slice = grades.slice(0, k);
  if (slice.length === 0) return 0;
  const relevant = slice.filter((g) => g >= 2).length;
  return relevant / k;
}

function dcgAtK(grades: Grade[], k: number): number {
  let sum = 0;
  const limit = Math.min(k, grades.length);
  for (let i = 0; i < limit; i++) {
    const gain = Math.pow(2, grades[i]) - 1;
    const discount = Math.log2(i + 2);
    sum += gain / discount;
  }
  return sum;
}

function ndcgAtK(grades: Grade[], k: number): number {
  const actual = dcgAtK(grades, k);
  const idealGrades = [...grades].sort((a, b) => b - a);
  const ideal = dcgAtK(idealGrades, k);
  if (ideal === 0) return 0;
  return actual / ideal;
}

async function main() {
  const rootDir = path.resolve(__dirname, '../..');
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
  const env = loadEnv();
  const profilesPath = path.join(rootDir, 'eval', 'profiles.json');
  const labelsPath = path.join(rootDir, 'eval', 'labels.json');
  const thresholdsPath = path.join(rootDir, 'eval', 'thresholds.json');

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

  const allLabels: AllLabels = fs.existsSync(labelsPath)
    ? (JSON.parse(fs.readFileSync(labelsPath, 'utf8')) as AllLabels)
    : {};
  const thresholds: Thresholds = fs.existsSync(thresholdsPath)
    ? (JSON.parse(fs.readFileSync(thresholdsPath, 'utf8')) as Thresholds)
    : { precisionAt10: 0, ndcgAt10: 0 };

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  let thresholdFailed = false;

  try {
    const repo = new PostgresOpportunityRepository(pool);
    const ai = new OllamaAdapter({
      baseUrl: env.OLLAMA_BASE_URL,
      embedModel: env.OLLAMA_EMBED_MODEL,
      chatModel: env.OLLAMA_CHAT_MODEL,
      embedTimeoutMs: env.OLLAMA_EMBED_TIMEOUT_MS,
      chatTimeoutMs: env.OLLAMA_CHAT_TIMEOUT_MS,
    });
    const matching = new MatchingService(ai);

    for (const profile of profiles) {
      const profileLabels = allLabels[profile.id] ?? {};
      const labeledIds = Object.keys(profileLabels);

      console.log(`\n================================================================================`);
      console.log(`PROFILE: ${profile.id} — ${profile.sector}`);
      console.log(`Labeled candidates: ${labeledIds.length}`);
      console.log(`================================================================================`);

      if (labeledIds.length === 0) {
        console.log('No labeled candidates found in eval/labels.json for this profile.');
        if (thresholds.precisionAt10 > 0 || thresholds.ndcgAt10 > 0) {
          thresholdFailed = true;
        }
        continue;
      }

      const loaded = await Promise.all(
        labeledIds.map((id) => repo.findById(id as OpportunityId)),
      );
      const opportunities = loaded.filter((o): o is Opportunity => o !== null);

      const profileVec = await ai.embed(MatchingService.buildProfileText(profile));
      const sims = await pool.query<{ id: string; cos: number }>(
        `SELECT opportunity_id AS id, 1 - (embedding <=> $1::vector) AS cos
         FROM opportunity_embeddings
         WHERE opportunity_id = ANY($2::text[])`,
        [`[${profileVec.join(',')}]`, opportunities.map((o) => o.id)],
      );
      const cosById = new Map(sims.rows.map((r) => [r.id, Number(r.cos)]));

      const scored: Array<{
        opp: Opportunity;
        label: Grade;
        breakdown: ScoringBreakdown;
      }> = [];

      for (const opp of opportunities) {
        const rawCos = cosById.get(opp.id);
        const semantic =
          rawCos !== undefined ? MatchingService.normalizeCosine(rawCos) : undefined;
        const breakdown = await matching.computeBreakdown(opp, profile, semantic);
        scored.push({
          opp,
          label: profileLabels[opp.id] ?? 0,
          breakdown,
        });
      }

      scored.sort(
        (a, b) =>
          b.breakdown.combinedScore - a.breakdown.combinedScore ||
          a.opp.id.localeCompare(b.opp.id),
      );

      console.log(
        'Rank | Score  | Label | Sem    | Cat    | Amount | Loc    | ID                                   | Title',
      );
      console.log(
        '-----+--------+-------+--------+--------+--------+--------+--------------------------------------+--------------------------------------------------',
      );

      scored.forEach((item, index) => {
        const rank = index + 1;
        const b = item.breakdown;
        console.log(
          `${String(rank).padStart(4)} | ${b.combinedScore.toFixed(4)} | ${String(item.label).padStart(5)} | ${b.semanticSimilarity.toFixed(4)} | ${b.categoryMatch.toFixed(4)} | ${b.amountFit.toFixed(4)} | ${b.locationMatch.toFixed(4)} | ${item.opp.id.padEnd(36)} | ${item.opp.title.slice(0, 50)}`,
        );
      });

      const grades = scored.map((s) => s.label);
      const p5 = precisionAtK(grades, 5);
      const p10 = precisionAtK(grades, 10);
      const ndcg10 = ndcgAtK(grades, 10);

      const label2Ranks = scored
        .map((s, idx) => ({ label: s.label, rank: idx + 1 }))
        .filter((x) => x.label === 2)
        .map((x) => x.rank);

      const meanRankLabel2 =
        label2Ranks.length > 0
          ? (label2Ranks.reduce((acc, r) => acc + r, 0) / label2Ranks.length).toFixed(2)
          : 'N/A';

      console.log('\nMetrics:');
      console.log(`  precision@5:        ${p5.toFixed(4)}`);
      console.log(`  precision@10:       ${p10.toFixed(4)} (threshold: ${thresholds.precisionAt10})`);
      console.log(`  nDCG@10:            ${ndcg10.toFixed(4)} (threshold: ${thresholds.ndcgAt10})`);
      console.log(`  mean rank (label=2): ${meanRankLabel2}`);

      const missedLabel2 = scored
        .map((s, idx) => ({ ...s, rank: idx + 1 }))
        .filter((s) => s.label === 2 && s.rank > 10);

      console.log(`\nLabel-2 items below rank 10 (${missedLabel2.length}):`);
      for (const item of missedLabel2) {
        const b = item.breakdown;
        console.log(
          `  rank=${item.rank} id=${item.opp.id} score=${b.combinedScore.toFixed(4)} [sem=${b.semanticSimilarity.toFixed(4)}, cat=${b.categoryMatch.toFixed(4)}, amt=${b.amountFit.toFixed(4)}, loc=${b.locationMatch.toFixed(4)}] "${item.opp.title.slice(0, 60)}"`,
        );
      }

      const falsePosTop5 = scored
        .slice(0, 5)
        .map((s, idx) => ({ ...s, rank: idx + 1 }))
        .filter((s) => s.label === 0);

      console.log(`\nLabel-0 items in top 5 (${falsePosTop5.length}):`);
      for (const item of falsePosTop5) {
        const b = item.breakdown;
        console.log(
          `  rank=${item.rank} id=${item.opp.id} score=${b.combinedScore.toFixed(4)} [sem=${b.semanticSimilarity.toFixed(4)}, cat=${b.categoryMatch.toFixed(4)}, amt=${b.amountFit.toFixed(4)}, loc=${b.locationMatch.toFixed(4)}] "${item.opp.title.slice(0, 60)}"`,
        );
      }

      if (p10 < thresholds.precisionAt10 || ndcg10 < thresholds.ndcgAt10) {
        console.error(
          `THRESHOLD FAILURE for ${profile.id}: precision@10=${p10.toFixed(4)} (min ${thresholds.precisionAt10}), nDCG@10=${ndcg10.toFixed(4)} (min ${thresholds.ndcgAt10})`,
        );
        thresholdFailed = true;
      }
    }
  } finally {
    await pool.end();
  }

  if (thresholdFailed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
