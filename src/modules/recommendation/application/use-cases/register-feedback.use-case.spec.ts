import { RegisterFeedbackUseCase } from './register-feedback.use-case';
import { RecommendationRepositoryPort } from '../../domain/ports/recommendation.repository.port';
import { Recommendation } from '../../domain/entities/recommendation.entity';
import {
  RecommendationId,
  ProfileId,
  UserId,
  asRecommendationId,
  asProfileId,
  asOpportunityId,
} from '../../../shared/domain/typed-id';

class FakeRecommendationRepository implements RecommendationRepositoryPort {
  public store: Map<string, Recommendation> = new Map();

  async save(recommendation: Recommendation): Promise<void> {
    this.store.set(recommendation.id, recommendation);
  }

  async findByProfile(profileId: ProfileId): Promise<Recommendation[]> {
    return Array.from(this.store.values()).filter(
      (r) => r.profileId === profileId,
    );
  }

  async findById(
    id: RecommendationId,
    _userId?: UserId,
  ): Promise<Recommendation | null> {
    return this.store.get(id) ?? null;
  }
}

describe('RegisterFeedbackUseCase', () => {
  let repository: FakeRecommendationRepository;
  let useCase: RegisterFeedbackUseCase;

  const testRec: Recommendation = {
    id: asRecommendationId('rec-1'),
    profileId: asProfileId('prof-1'),
    opportunityId: asOpportunityId('opp-1'),
    score: 0.85,
    explanation: {
      summary: 'Buena coincidencia',
      matchedFactors: [],
    },
    feedback: null,
  };

  beforeEach(() => {
    repository = new FakeRecommendationRepository();
    useCase = new RegisterFeedbackUseCase(repository);
  });

  it('returns RecommendationNotFoundError when recommendation does not exist', async () => {
    const result = await useCase.execute({
      recommendationId: asRecommendationId('non-existent'),
      decision: 'Participate',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('RecommendationNotFoundError');
      expect(result.error.recommendationId).toBe('non-existent');
    }
  });

  it('records Participate decision and updates recommendation in repository', async () => {
    await repository.save(testRec);

    const result = await useCase.execute({
      recommendationId: testRec.id,
      decision: 'Participate',
    });

    expect(result.ok).toBe(true);
    const updated = await repository.findById(testRec.id);
    expect(updated?.feedback).not.toBeNull();
    expect(updated?.feedback?.decision).toBe('Participate');
    expect(updated?.feedback?.recordedAt).toBeInstanceOf(Date);
  });

  it('records Discard decision and updates recommendation in repository', async () => {
    await repository.save(testRec);

    const result = await useCase.execute({
      recommendationId: testRec.id,
      decision: 'Discard',
    });

    expect(result.ok).toBe(true);
    const updated = await repository.findById(testRec.id);
    expect(updated?.feedback?.decision).toBe('Discard');
  });
});
