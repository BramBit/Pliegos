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

  describe('P3.4 Recommendation Feed & Feedback Transactions', () => {
    it('recordFeedbackWithWatch creates a watch on Participate and removes it on Discard in the same transaction', async () => {
      const profileId = asProfileId('prof-rec-1');
      const oppId = asOpportunityId('opp-1');
      const recId = asRecommendationId('rec-trans-1');

      await repo.save({
        id: recId,
        profileId,
        opportunityId: oppId,
        score: 0.88,
        explanation: { summary: 'Match', matchedFactors: [] },
        feedback: null,
      });

      // 1. Participate -> updates feedback AND creates watch in watches
      const updated = await repo.recordFeedbackWithWatch(recId, 'Participate');
      expect(updated?.feedback?.decision).toBe('Participate');

      const watchCheck1 = await pool.query(
        'SELECT * FROM watches WHERE profile_id = $1 AND opportunity_id = $2;',
        [profileId, oppId],
      );
      expect(watchCheck1.rows).toHaveLength(1);

      // 2. Discard -> updates feedback AND deletes watch from watches
      const updated2 = await repo.recordFeedbackWithWatch(recId, 'Discard');
      expect(updated2?.feedback?.decision).toBe('Discard');

      const watchCheck2 = await pool.query(
        'SELECT * FROM watches WHERE profile_id = $1 AND opportunity_id = $2;',
        [profileId, oppId],
      );
      expect(watchCheck2.rows).toHaveLength(0);
    });

    it('clearFeedbackWithWatch undoes Participate by removing watch and resetting feedback to null', async () => {
      const profileId = asProfileId('prof-rec-1');
      const oppId = asOpportunityId('opp-1');
      const recId = asRecommendationId('rec-trans-2');

      await repo.save({
        id: recId,
        profileId,
        opportunityId: oppId,
        score: 0.88,
        explanation: { summary: 'Match', matchedFactors: [] },
        feedback: null,
      });

      await repo.recordFeedbackWithWatch(recId, 'Participate');

      const watchBefore = await pool.query(
        'SELECT * FROM watches WHERE profile_id = $1 AND opportunity_id = $2;',
        [profileId, oppId],
      );
      expect(watchBefore.rows).toHaveLength(1);

      // Undo feedback
      const cleared = await repo.clearFeedbackWithWatch(recId);
      expect(cleared?.feedback).toBeNull();

      const watchAfter = await pool.query(
        'SELECT * FROM watches WHERE profile_id = $1 AND opportunity_id = $2;',
        [profileId, oppId],
      );
      expect(watchAfter.rows).toHaveLength(0);
    });

    it('findFeed executes in EXACTLY 1 database query (asserted with query counter) and honors filters', async () => {
      const profileId = asProfileId('prof-rec-1');

      // Record a recommendation run
      await repo.recordRun({
        id: 'run-feed-1',
        profileId,
        startedAt: new Date(Date.now() - 60000),
        finishedAt: new Date(),
        candidates: 200,
        kept: 2,
        level: 'hybrid',
        degraded: false,
      });

      // Rec 1: score 0.90, feedback Participate
      await repo.save({
        id: asRecommendationId('rec-f-1'),
        profileId,
        opportunityId: asOpportunityId('opp-1'),
        score: 0.90,
        explanation: { summary: 'Match 1', matchedFactors: [], unavailableFactors: [] },
        feedback: { decision: 'Participate', recordedAt: new Date() },
      });

      // Rec 2: score 0.60, feedback NULL (new)
      await repo.save({
        id: asRecommendationId('rec-f-2'),
        profileId,
        opportunityId: asOpportunityId('opp-2'),
        score: 0.60,
        explanation: { summary: 'Match 2', matchedFactors: [], unavailableFactors: [] },
        feedback: null,
      });

      // Set up a query counter on pool.query
      let queryCount = 0;
      const originalQuery = pool.query.bind(pool);
      const countingPool = Object.create(pool);
      countingPool.query = (...args: any[]) => {
        queryCount++;
        return (originalQuery as any)(...args);
      };

      const countedRepo = new PostgresRecommendationRepository(countingPool);

      // Test 1: state 'all'
      queryCount = 0;
      const feedAll = await countedRepo.findFeed(profileId, { state: 'all' });
      expect(queryCount).toBe(1); // EXACTLY ONE QUERY
      expect(feedAll.profileExists).toBe(true);
      expect(feedAll.total).toBe(2);
      expect(feedAll.items).toHaveLength(2);
      expect(feedAll.items[0].id).toBe('rec-f-1'); // score 0.90 first
      expect(feedAll.items[0].opportunity.id).toBe('opp-1');
      expect(feedAll.lastRefreshedAt).not.toBeNull();
      expect(feedAll.degraded).toBe(false);

      // Test 2: state 'new'
      queryCount = 0;
      const feedNew = await countedRepo.findFeed(profileId, { state: 'new' });
      expect(queryCount).toBe(1); // EXACTLY ONE QUERY
      expect(feedNew.total).toBe(1);
      expect(feedNew.items[0].id).toBe('rec-f-2');

      // Test 3: minScore 0.80
      queryCount = 0;
      const feedScore = await countedRepo.findFeed(profileId, { state: 'all', minScore: 0.80 });
      expect(queryCount).toBe(1); // EXACTLY ONE QUERY
      expect(feedScore.total).toBe(1);
      expect(feedScore.items[0].id).toBe('rec-f-1');

      // Test 4: unknown profile
      queryCount = 0;
      const feedMissing = await countedRepo.findFeed(asProfileId('00000000-0000-0000-0000-000000000000'));
      expect(queryCount).toBe(1); // EXACTLY ONE QUERY
      expect(feedMissing.profileExists).toBe(false);
      expect(feedMissing.total).toBe(0);
      expect(feedMissing.items).toHaveLength(0);
    });
  });
});
