import { Result, ok, err } from '../../../shared/domain/result';
import {
  ProfileNotFoundError,
  createProfileNotFoundError,
} from '../../../shared/domain/errors';
import { ProfileId } from '../../../shared/domain/typed-id';
import { ProfileRepositoryPort } from '../../../profile/domain/ports/profile.repository.port';
import { OpportunityRepositoryPort } from '../../../opportunity/domain/ports/opportunity.repository.port';
import { RecommendationRepositoryPort } from '../../domain/ports/recommendation.repository.port';
import { Recommendation } from '../../domain/entities/recommendation.entity';
import { MatchingService } from '../../domain/services/matching.service';

export interface IGetRecommendationsUseCase {
  execute(input: {
    profileId: ProfileId;
  }): Promise<Result<Recommendation[], ProfileNotFoundError>>;
}

export class GetRecommendationsUseCase implements IGetRecommendationsUseCase {
  constructor(
    private readonly profileRepository: ProfileRepositoryPort,
    private readonly opportunityRepository: OpportunityRepositoryPort,
    private readonly recommendationRepository: RecommendationRepositoryPort,
    private readonly matchingService: MatchingService,
  ) {}

  async execute(input: {
    profileId: ProfileId;
  }): Promise<Result<Recommendation[], ProfileNotFoundError>> {
    const profile = await this.profileRepository.findById(input.profileId);
    if (!profile) {
      return err(createProfileNotFoundError(input.profileId));
    }

    // Retrieve candidate opportunities to score
    const candidates = await this.opportunityRepository.findByFilters({});

    const recommendations: Recommendation[] = [];
    for (const opportunity of candidates) {
      const rec = await this.matchingService.score(opportunity, profile);
      await this.recommendationRepository.save(rec);
      recommendations.push(rec);
    }

    // Rank descending by score
    recommendations.sort((a, b) => b.score - a.score);

    return ok(recommendations);
  }
}
