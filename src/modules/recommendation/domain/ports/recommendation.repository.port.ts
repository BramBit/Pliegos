import { Recommendation } from '../entities/recommendation.entity';
import { ProfileId, RecommendationId } from '../../../shared/domain/typed-id';
import { RetrievalLevel } from '../../../opportunity/domain/ports/search-index.port';

export interface ProfileEmbeddingRecord {
  readonly profileId: ProfileId;
  readonly textHash: string;
  readonly embeddingModel: string;
  readonly embedding: number[];
}

export interface RecommendationRun {
  readonly id: string;
  readonly profileId: ProfileId;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly candidates: number;
  readonly kept: number;
  readonly level: RetrievalLevel;
  readonly degraded: boolean;
}

export interface RecommendationPageOptions {
  readonly page?: number;
  readonly pageSize?: number;
  readonly minScore?: number;
}

export interface PagedRecommendations {
  readonly items: Recommendation[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface RecommendationRepositoryPort {
  save(recommendation: Recommendation): Promise<void>;
  findByProfile(profileId: ProfileId): Promise<Recommendation[]>;
  findById(id: RecommendationId): Promise<Recommendation | null>;
  upsertMany?(
    profileId: ProfileId,
    recommendations: Recommendation[],
  ): Promise<Recommendation[]>;
  findByProfilePaged?(
    profileId: ProfileId,
    options?: RecommendationPageOptions,
  ): Promise<PagedRecommendations>;
  getProfileEmbedding?(profileId: ProfileId): Promise<ProfileEmbeddingRecord | null>;
  saveProfileEmbedding?(record: ProfileEmbeddingRecord): Promise<void>;
  recordRun?(run: RecommendationRun): Promise<void>;
  getLatestRun?(profileId: ProfileId): Promise<RecommendationRun | null>;
  findAllProfileIds?(): Promise<ProfileId[]>;
}

export const RECOMMENDATION_REPOSITORY_PORT = Symbol('RECOMMENDATION_REPOSITORY_PORT');
