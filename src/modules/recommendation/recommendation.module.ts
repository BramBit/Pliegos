import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../shared/infrastructure/persistence/database.module';
import { AiModule } from '../shared/infrastructure/ai/ai.module';
import { EMBEDDER_PORT, EmbedderPort } from './domain/ports/ai-provider.port';
import { RECOMMENDATION_REPOSITORY_PORT } from './domain/ports/recommendation.repository.port';
import { PostgresRecommendationRepository } from './infrastructure/adapters/persistence/postgres-recommendation.repository';
import { MatchingService } from './domain/services/matching.service';
import { GetRecommendationsUseCase } from './application/use-cases/get-recommendations.use-case';
import { RegisterFeedbackUseCase } from './application/use-cases/register-feedback.use-case';
import { RecommendationController } from './infrastructure/controllers/recommendation.controller';
import { ProfileModule } from '../profile/profile.module';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { PROFILE_REPOSITORY_PORT } from '../profile/domain/ports/profile.repository.port';
import { OPPORTUNITY_REPOSITORY_PORT } from '../opportunity/domain/ports/opportunity.repository.port';
import { SEARCH_INDEX_PORT, SearchIndexPort } from '../opportunity/domain/ports/search-index.port';

@Module({
  imports: [AiModule, ProfileModule, OpportunityModule],
  controllers: [RecommendationController],
  providers: [
    {
      provide: RECOMMENDATION_REPOSITORY_PORT,
      useFactory: (pool: Pool) => new PostgresRecommendationRepository(pool),
      inject: [DATABASE_POOL],
    },
    {
      provide: MatchingService,
      useFactory: () => new MatchingService(),
    },
    {
      provide: GetRecommendationsUseCase,
      useFactory: (
        profileRepo,
        oppRepo,
        recRepo,
        matchingService: MatchingService,
        embedder: EmbedderPort,
        searchIndex: SearchIndexPort,
      ) =>
        new GetRecommendationsUseCase(
          profileRepo,
          oppRepo,
          recRepo,
          matchingService,
          embedder,
          searchIndex,
        ),
      inject: [
        PROFILE_REPOSITORY_PORT,
        OPPORTUNITY_REPOSITORY_PORT,
        RECOMMENDATION_REPOSITORY_PORT,
        MatchingService,
        EMBEDDER_PORT,
        SEARCH_INDEX_PORT,
      ],
    },
    {
      provide: RegisterFeedbackUseCase,
      useFactory: (recRepo) => new RegisterFeedbackUseCase(recRepo),
      inject: [RECOMMENDATION_REPOSITORY_PORT],
    },
  ],
  exports: [
    RECOMMENDATION_REPOSITORY_PORT,
    MatchingService,
    GetRecommendationsUseCase,
    RegisterFeedbackUseCase,
  ],
})
export class RecommendationModule {}
