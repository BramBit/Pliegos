import { createHash, randomUUID } from 'node:crypto';
import { Result, ok, err } from '../../../shared/domain/result';
import {
  ProfileNotFoundError,
  createProfileNotFoundError,
} from '../../../shared/domain/errors';
import { OpportunityId, ProfileId } from '../../../shared/domain/typed-id';
import { ProfileRepositoryPort } from '../../../profile/domain/ports/profile.repository.port';
import { OpportunityRepositoryPort } from '../../../opportunity/domain/ports/opportunity.repository.port';
import { SearchIndexPort } from '../../../opportunity/domain/ports/search-index.port';
import { AnalysisQueuePort } from '../../../opportunity/domain/ports/analysis-queue.port';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';
import { hasGeneratedSummary } from '../../../opportunity/infrastructure/jobs/analyze-opportunity.job';
import {
  RecommendationRepositoryPort,
  RecommendationRun,
} from '../../domain/ports/recommendation.repository.port';
import { EmbedderPort } from '../../domain/ports/ai-provider.port';
import { Recommendation } from '../../domain/entities/recommendation.entity';
import {
  MatchingService,
  buildProfileQuery,
  getMinRecommendationScore,
} from '../../domain/services/matching.service';

export const REFRESH_CANDIDATE_POOL_SIZE = 200;
export const TOP_RECOMMENDATIONS_KEPT = 50;

export function computeProfileQueryHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface RefreshRecommendationsOutput {
  readonly recommendations: Recommendation[];
  readonly run: RecommendationRun;
}

export class RefreshRecommendationsUseCase {
  constructor(
    private readonly profileRepository: ProfileRepositoryPort,
    private readonly opportunityRepository: OpportunityRepositoryPort,
    private readonly recommendationRepository: RecommendationRepositoryPort,
    private readonly matchingService: MatchingService,
    private readonly embedder: EmbedderPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly minRecommendationScore?: number,
    private readonly analysisQueue?: AnalysisQueuePort,
  ) {}

  async execute(input: {
    profileId: ProfileId;
  }): Promise<Result<RefreshRecommendationsOutput, ProfileNotFoundError>> {
    const startedAt = new Date();
    const profile = await this.profileRepository.findById(input.profileId);
    if (!profile) {
      return err(createProfileNotFoundError(input.profileId));
    }

    const profileText = buildProfileQuery(profile);
    const textHash = computeProfileQueryHash(profileText);

    let profileVector: number[];
    const cachedEmbedding =
      await this.recommendationRepository.getProfileEmbedding?.(profile.id);

    if (
      cachedEmbedding &&
      cachedEmbedding.textHash === textHash &&
      cachedEmbedding.embeddingModel === this.embedder.model &&
      cachedEmbedding.embedding.length === this.embedder.dimensions
    ) {
      profileVector = cachedEmbedding.embedding;
    } else {
      const [embedded] = await this.embedder.embed([profileText]);
      profileVector = embedded;
      if (this.recommendationRepository.saveProfileEmbedding) {
        await this.recommendationRepository.saveProfileEmbedding({
          profileId: profile.id,
          textHash,
          embeddingModel: this.embedder.model,
          embedding: profileVector,
        });
      }
    }

    const retrieval = await this.searchIndex.retrieveCandidates(
      {
        text: profileText,
        vector: profileVector,
        mode: 'profile',
      },
      {
        onlyCompetitive: true,
        actionable: true,
      },
      REFRESH_CANDIDATE_POOL_SIZE,
    );

    const existing = await this.recommendationRepository.findByProfile(
      profile.id,
    );
    const existingByOpportunity = new Map(
      existing.map((r) => [r.opportunityId, r]),
    );
    const minScore = this.minRecommendationScore ?? getMinRecommendationScore();

    const qualifying: Recommendation[] = [];
    const loadedOpportunities = new Map<OpportunityId, Opportunity>();
    for (const item of retrieval.items) {
      const opportunity = await this.opportunityRepository.findById(item.id);
      if (!opportunity) continue;
      loadedOpportunities.set(opportunity.id, opportunity);

      const previous = existingByOpportunity.get(opportunity.id);
      const semanticSimilarity =
        item.cosine !== null
          ? MatchingService.normalizeCosine(item.cosine)
          : null;
      const scored = await this.matchingService.score(
        opportunity,
        profile,
        semanticSimilarity,
        previous?.id,
      );

      if (scored.score < minScore) {
        continue;
      }

      const rec: Recommendation = previous
        ? { ...scored, feedback: previous.feedback }
        : scored;
      qualifying.push(rec);
    }

    qualifying.sort((a, b) => b.score - a.score);
    const top50 = qualifying.slice(0, TOP_RECOMMENDATIONS_KEPT);

    if (this.analysisQueue) {
      for (const rec of top50) {
        const opp = loadedOpportunities.get(rec.opportunityId);
        if (opp && !hasGeneratedSummary(opp.analysis)) {
          await this.analysisQueue.enqueueAnalysis(opp.id, { summarize: true });
        }
      }
    }

    let persisted: Recommendation[];
    if (this.recommendationRepository.upsertMany) {
      persisted = await this.recommendationRepository.upsertMany(
        profile.id,
        top50,
      );
    } else {
      for (const rec of top50) {
        await this.recommendationRepository.save(rec);
      }
      persisted = top50;
    }

    const finishedAt = new Date();
    const run: RecommendationRun = {
      id: randomUUID(),
      profileId: profile.id,
      startedAt,
      finishedAt,
      candidates: retrieval.items.length,
      kept: persisted.length,
      level: retrieval.level,
      degraded: retrieval.degraded,
    };

    if (this.recommendationRepository.recordRun) {
      await this.recommendationRepository.recordRun(run);
    }

    return ok({
      recommendations: persisted,
      run,
    });
  }
}
