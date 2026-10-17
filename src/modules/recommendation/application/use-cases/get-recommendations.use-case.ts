import { Result, ok, err } from '../../../shared/domain/result';
import {
  ProfileNotFoundError,
  createProfileNotFoundError,
} from '../../../shared/domain/errors';
import { OpportunityId, ProfileId } from '../../../shared/domain/typed-id';
import { ProfileRepositoryPort } from '../../../profile/domain/ports/profile.repository.port';
import { OpportunityRepositoryPort } from '../../../opportunity/domain/ports/opportunity.repository.port';
import { SearchIndexPort } from '../../../opportunity/domain/ports/search-index.port';
import { RecommendationRepositoryPort } from '../../domain/ports/recommendation.repository.port';
import { EmbedderPort } from '../../domain/ports/ai-provider.port';
import { Recommendation } from '../../domain/entities/recommendation.entity';
import { MatchingService, buildProfileQuery } from '../../domain/services/matching.service';

export const CANDIDATE_POOL_SIZE = 100;
export const DEFAULT_RECOMMENDATION_LIMIT = 20;

export interface IGetRecommendationsUseCase {
  execute(input: {
    profileId: ProfileId;
    limit?: number;
  }): Promise<Result<Recommendation[], ProfileNotFoundError>>;
}

export class GetRecommendationsUseCase implements IGetRecommendationsUseCase {
  constructor(
    private readonly profileRepository: ProfileRepositoryPort,
    private readonly opportunityRepository: OpportunityRepositoryPort,
    private readonly recommendationRepository: RecommendationRepositoryPort,
    private readonly matchingService: MatchingService,
    private readonly embedder: EmbedderPort,
    private readonly searchIndex: SearchIndexPort,
  ) {}

  async execute(input: {
    profileId: ProfileId;
    limit?: number;
  }): Promise<Result<Recommendation[], ProfileNotFoundError>> {
    const profile = await this.profileRepository.findById(input.profileId);
    if (!profile) {
      return err(createProfileNotFoundError(input.profileId));
    }

    // Retrieve candidate opportunities still open to bidders
    const candidates = await this.opportunityRepository.findByFilters({
      actionableOnly: true,
      limit: CANDIDATE_POOL_SIZE,
    });

    let cosinesById = new Map<OpportunityId, number>();
    if (candidates.length > 0) {
      const profileText = buildProfileQuery(profile);
      const [profileVector] = await this.embedder.embed([profileText]);
      cosinesById = await this.searchIndex.similarities(
        profileVector,
        candidates.map((c) => c.id),
      );
    }

    // Reuse the existing recommendation (id + feedback) per opportunity to avoid duplicates
    const existing = await this.recommendationRepository.findByProfile(input.profileId);
    const existingByOpportunity = new Map(existing.map((r) => [r.opportunityId, r]));

    const recommendations: Recommendation[] = [];
    for (const opportunity of candidates) {
      const previous = existingByOpportunity.get(opportunity.id);
      const rawCosine = cosinesById.get(opportunity.id);
      const semanticSimilarity =
        rawCosine !== undefined ? MatchingService.normalizeCosine(rawCosine) : null;
      const scored = await this.matchingService.score(
        opportunity,
        profile,
        semanticSimilarity,
        previous?.id,
      );
      const rec: Recommendation = previous ? { ...scored, feedback: previous.feedback } : scored;
      await this.recommendationRepository.save(rec);
      recommendations.push(rec);
    }

    // Rank descending by score and return the top N
    recommendations.sort((a, b) => b.score - a.score);

    return ok(recommendations.slice(0, input.limit ?? DEFAULT_RECOMMENDATION_LIMIT));
  }
}
