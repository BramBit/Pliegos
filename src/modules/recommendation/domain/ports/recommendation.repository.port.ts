import { Recommendation } from '../entities/recommendation.entity';
import { ProfileId, RecommendationId } from '../../../shared/domain/typed-id';

export interface RecommendationRepositoryPort {
  save(recommendation: Recommendation): Promise<void>;
  findByProfile(profileId: ProfileId): Promise<Recommendation[]>;
  findById(id: RecommendationId): Promise<Recommendation | null>;
}

export const RECOMMENDATION_REPOSITORY_PORT = Symbol('RECOMMENDATION_REPOSITORY_PORT');
