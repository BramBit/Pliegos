import { Result, ok, err } from '../../../shared/domain/result';
import {
  ProfileNotFoundError,
  createProfileNotFoundError,
} from '../../../shared/domain/errors';
import { ProfileId } from '../../../shared/domain/typed-id';
import {
  RecommendationRepositoryPort,
  RecommendationFeedOptions,
  PagedRecommendationFeed,
} from '../../domain/ports/recommendation.repository.port';

export interface GetRecommendationFeedInput {
  profileId: ProfileId;
  options?: RecommendationFeedOptions;
}

export class GetRecommendationFeedUseCase {
  constructor(
    private readonly recommendationRepository: RecommendationRepositoryPort,
  ) {}

  async execute(
    input: GetRecommendationFeedInput,
  ): Promise<Result<PagedRecommendationFeed, ProfileNotFoundError>> {
    if (!this.recommendationRepository.findFeed) {
      throw new Error(
        'findFeed is not implemented on RecommendationRepositoryPort',
      );
    }

    const feed = await this.recommendationRepository.findFeed(
      input.profileId,
      input.options,
    );

    if (feed.profileExists === false) {
      return err(createProfileNotFoundError(input.profileId));
    }

    return ok(feed);
  }
}
