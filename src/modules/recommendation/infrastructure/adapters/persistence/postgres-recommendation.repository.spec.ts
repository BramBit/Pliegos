import { Pool } from 'pg';
import { PostgresRecommendationRepository } from './postgres-recommendation.repository';
import { initDatabaseSchema } from '../../../../shared/infrastructure/persistence/database.schema';
import { Recommendation } from '../../../domain/entities/recommendation.entity';
import {
  asRecommendationId,
  asProfileId,
  asOpportunityId,
} from '../../../../shared/domain/typed-id';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/pliegos_test';

describe('PostgresRecommendationRepository (Real Test Database)', () => {
  let pool: Pool;
  let repo: PostgresRecommendationRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await initDatabaseSchema(pool);
    repo = new PostgresRecommendationRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM recommendations;');
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
    // Ordered descending by score
    expect(list[0].id).toBe('rec-2');
    expect(list[0].score).toBe(0.95);
    expect(list[1].id).toBe('rec-1');
    expect(list[1].score).toBe(0.75);
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
