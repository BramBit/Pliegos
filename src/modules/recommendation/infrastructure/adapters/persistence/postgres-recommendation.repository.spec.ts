import { seedOpportunity, seedProfile } from '../../../../shared/testing/seed';
import { requireTestDatabaseUrl } from '../../../../shared/testing/test-database-url';
import { Pool } from 'pg';
import { PostgresRecommendationRepository } from './postgres-recommendation.repository';
import { migrateTestDatabase } from '../../../../shared/testing/migrate-test-database';
import { Recommendation } from '../../../domain/entities/recommendation.entity';
import {
  asRecommendationId,
  asProfileId,
  asOpportunityId,
} from '../../../../shared/domain/typed-id';

const TEST_DATABASE_URL = requireTestDatabaseUrl();

describe('PostgresRecommendationRepository (Real Test Database)', () => {
  let pool: Pool;
  let repo: PostgresRecommendationRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await migrateTestDatabase(pool);
    repo = new PostgresRecommendationRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM recommendation_runs;');
    await pool.query('DELETE FROM profile_embeddings;');
    await pool.query('DELETE FROM recommendations;');
    for (const id of ['prof-rec-1', 'prof-fb']) await seedProfile(pool, id);
    for (const id of ['opp-1', 'opp-2', 'opp-3', 'opp-fb']) await seedOpportunity(pool, id);
  });

  it('saves and finds recommendations by profile ordered by score descending', async () => {
    const profileId = asProfileId('prof-rec-1');

    const rec1: Recommendation = {
      id: asRecommendationId('rec-1'),
      profileId,
      opportunityId: asOpportunityId('opp-1'),
      score: 0.75,
      explanation: {
        summary: 'Buena coincidencia en categoria y monto',
        matchedFactors: [
          {
            factor: 'categoryMatch',
            score: 1.0,
            description: 'Coincide con tu categoria declarada',
          },
        ],
      },
      feedback: null,
    };

    const rec2: Recommendation = {
      id: asRecommendationId('rec-2'),
      profileId,
      opportunityId: asOpportunityId('opp-2'),
      score: 0.95,
      explanation: {
        summary: 'Excelente coincidencia semantica y presupuestal',
        matchedFactors: [
          {
            factor: 'semanticSimilarity',
            score: 0.92,
            description: 'Alta afinidad semantica',
          },
        ],
      },
      feedback: null,
    };

    await repo.save(rec1);
    await repo.save(rec2);

    const list = await repo.findByProfile(profileId);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('rec-2');
    expect(list[0].score).toBe(0.95);
    expect(list[1].id).toBe('rec-1');
    expect(list[1].score).toBe(0.75);
  });

  it('upsertMany preserves existing id and feedback on conflict, and deletes stale rows without feedback', async () => {
    const profileId = asProfileId('prof-rec-1');

    // Initial recommendations: opp-1 (with feedback), opp-2 (no feedback)
    await repo.save({
      id: asRecommendationId('rec-orig-1'),
      profileId,
      opportunityId: asOpportunityId('opp-1'),
      score: 0.70,
      explanation: { summary: 'Initial 1', matchedFactors: [] },
      feedback: {
        decision: 'Participate',
        recordedAt: new Date('2026-03-15T10:00:00.000Z'),
      },
    });
    await repo.save({
      id: asRecommendationId('rec-orig-2'),
      profileId,
      opportunityId: asOpportunityId('opp-2'),
      score: 0.65,
      explanation: { summary: 'Initial 2 (stale, no feedback)', matchedFactors: [] },
      feedback: null,
    });

    // Now upsertMany with opp-1 (new score, new candidate id) and opp-3 (brand new); opp-2 is omitted
    const upserted = await repo.upsertMany(profileId, [
      {
        id: asRecommendationId('rec-new-generated-id'),
        profileId,
        opportunityId: asOpportunityId('opp-1'),
        score: 0.91,
        explanation: { summary: 'Updated 1', matchedFactors: [] },
        feedback: null,
      },
      {
        id: asRecommendationId('rec-3'),
        profileId,
        opportunityId: asOpportunityId('opp-3'),
        score: 0.80,
        explanation: { summary: 'New 3', matchedFactors: [] },
        feedback: null,
      },
    ]);

    expect(upserted).toHaveLength(2);

    const all = await repo.findByProfile(profileId);
    expect(all).toHaveLength(2);

    const opp1Rec = all.find((r) => r.opportunityId === 'opp-1')!;
    expect(opp1Rec.id).toBe('rec-orig-1'); // Preserved original ID
    expect(opp1Rec.score).toBe(0.91); // Updated score
    expect(opp1Rec.feedback?.decision).toBe('Participate'); // Preserved feedback

    const opp2Rec = all.find((r) => r.opportunityId === 'opp-2');
    expect(opp2Rec).toBeUndefined(); // Stale row without feedback was deleted
  });

  it('persists and retrieves profile_embeddings and recommendation_runs', async () => {
    const profileId = asProfileId('prof-rec-1');
    const vec = new Array(768).fill(0.02);

    await repo.saveProfileEmbedding({
      profileId,
      textHash: 'hash-123',
      embeddingModel: 'nomic-embed-text',
      embedding: vec,
    });

    const loadedEmb = await repo.getProfileEmbedding(profileId);
    expect(loadedEmb).not.toBeNull();
    expect(loadedEmb?.textHash).toBe('hash-123');
    expect(loadedEmb?.embeddingModel).toBe('nomic-embed-text');
    expect(loadedEmb?.embedding).toHaveLength(768);

    const startedAt = new Date('2026-03-20T10:00:00.000Z');
    const finishedAt = new Date('2026-03-20T10:00:05.000Z');
    await repo.recordRun({
      id: 'run-1',
      profileId,
      startedAt,
      finishedAt,
      candidates: 150,
      kept: 25,
      level: 'hybrid',
      degraded: false,
    });

    const latestRun = await repo.getLatestRun(profileId);
    expect(latestRun).not.toBeNull();
    expect(latestRun?.id).toBe('run-1');
    expect(latestRun?.candidates).toBe(150);
    expect(latestRun?.kept).toBe(25);
    expect(latestRun?.level).toBe('hybrid');
    expect(latestRun?.degraded).toBe(false);
    expect(latestRun?.finishedAt).toEqual(finishedAt);
  });

  it('updates feedback on an existing recommendation', async () => {
    const rec: Recommendation = {
      id: asRecommendationId('rec-fb'),
      profileId: asProfileId('prof-fb'),
      opportunityId: asOpportunityId('opp-fb'),
      score: 0.88,
      explanation: { summary: 'Match', matchedFactors: [] },
      feedback: null,
    };

    await repo.save(rec);

    const withFeedback: Recommendation = {
      ...rec,
      feedback: {
        decision: 'Participate',
        recordedAt: new Date('2026-03-15T10:00:00.000Z'),
      },
    };

    await repo.save(withFeedback);

    const retrieved = await repo.findById(rec.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.feedback).not.toBeNull();
    expect(retrieved?.feedback?.decision).toBe('Participate');
    expect(retrieved?.feedback?.recordedAt).toEqual(new Date('2026-03-15T10:00:00.000Z'));
  });

  it('returns null when recommendation is not found', async () => {
    const found = await repo.findById(asRecommendationId('missing-rec'));
    expect(found).toBeNull();
  });
});
