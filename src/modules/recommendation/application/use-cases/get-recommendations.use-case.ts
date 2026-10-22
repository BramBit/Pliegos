import { Result, ok, err } from '../../../shared/domain/result';
import {
  ProfileNotFoundError,
  createProfileNotFoundError,
} from '../../../shared/domain/errors';
import { ProfileId } from '../../../shared/domain/typed-id';
import { ProfileRepositoryPort } from '../../../profile/domain/ports/profile.repository.port';
import { RecommendationRepositoryPort } from '../../domain/ports/recommendation.repository.port';
import { Recommendation } from '../../domain/entities/recommendation.entity';

export const CANDIDATE_POOL_SIZE = 200;
export const DEFAULT_RECOMMENDATION_LIMIT = 20;

export interface GetRecommendationsReadResult {
  readonly items: Recommendation[];
  readonly lastRefreshedAt: Date | null;
  readonly degraded: boolean;
}

export type PersistedRecommendationsWithMeta = Recommendation[] &
  GetRecommendationsReadResult;

export interface IGetRecommendationsUseCase {
  execute(input: {
    profileId: ProfileId;
    limit?: number;
  }): Promise<Result<PersistedRecommendationsWithMeta, ProfileNotFoundError>>;
}

/**
 * Read-only use case returning persisted recommendations for a profile
 * together with lastRefreshedAt and degraded from the latest recommendation_runs row.
 * Never calls Ollama or writes to the database.
 */
export class GetRecommendationsUseCase implements IGetRecommendationsUseCase {
  constructor(
    private readonly profileRepository: ProfileRepositoryPort,
    private readonly recommendationRepository: RecommendationRepositoryPort,
  ) {}

  async execute(input: {
    profileId: ProfileId;
    limit?: number;
  }): Promise<Result<PersistedRecommendationsWithMeta, ProfileNotFoundError>> {
    const profile = await this.profileRepository.findById(input.profileId);
    if (!profile) {
      return err(createProfileNotFoundError(input.profileId));
    }

    const persisted = await this.recommendationRepository.findByProfile(
      input.profileId,
    );
    const sorted = [...persisted].sort((a, b) => b.score - a.score);
    const sliced = sorted.slice(0, input.limit ?? DEFAULT_RECOMMENDATION_LIMIT);

    const latestRun =
      (await this.recommendationRepository.getLatestRun?.(input.profileId)) ??
      null;

    const result = Object.assign([...sliced], {
      items: sliced,
      lastRefreshedAt: latestRun ? latestRun.finishedAt : null,
      degraded: latestRun ? latestRun.degraded : false,
    }) as PersistedRecommendationsWithMeta;

    return ok(result);
  }
}
