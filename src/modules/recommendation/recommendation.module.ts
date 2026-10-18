import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../shared/infrastructure/persistence/database.module';
import { AiModule } from '../shared/infrastructure/ai/ai.module';
import { EMBEDDER_PORT, EmbedderPort } from './domain/ports/ai-provider.port';
import {
  RECOMMENDATION_REPOSITORY_PORT,
  RecommendationRepositoryPort,
} from './domain/ports/recommendation.repository.port';
import {
  WATCH_REPOSITORY_PORT,
  WatchRepositoryPort,
} from './domain/ports/watch.repository.port';
import { PostgresRecommendationRepository } from './infrastructure/adapters/persistence/postgres-recommendation.repository';
import { PostgresWatchRepository } from './infrastructure/adapters/persistence/postgres-watch.repository';
import { MatchingService } from './domain/services/matching.service';
import { GetRecommendationsUseCase } from './application/use-cases/get-recommendations.use-case';
import { GetRecommendationFeedUseCase } from './application/use-cases/get-recommendation-feed.use-case';
import { RefreshRecommendationsUseCase } from './application/use-cases/refresh-recommendations.use-case';
import { RegisterFeedbackUseCase } from './application/use-cases/register-feedback.use-case';
import { UndoFeedbackUseCase } from './application/use-cases/undo-feedback.use-case';
import { WatchOpportunityUseCase } from './application/use-cases/watch-opportunity.use-case';
import { UnwatchOpportunityUseCase } from './application/use-cases/unwatch-opportunity.use-case';
import { GetWatchedOpportunitiesUseCase } from './application/use-cases/get-watched-opportunities.use-case';
import { GetProfileSummaryUseCase } from './application/use-cases/get-profile-summary.use-case';
import { RecommendationController } from './infrastructure/controllers/recommendation.controller';
import { ProfileRecommendationsController } from './infrastructure/controllers/profile-recommendations.controller';
import { ProfileModule } from '../profile/profile.module';
import { OpportunityModule } from '../opportunity/opportunity.module';
import {
  PROFILE_REPOSITORY_PORT,
  ProfileRepositoryPort,
} from '../profile/domain/ports/profile.repository.port';
import {
  OPPORTUNITY_REPOSITORY_PORT,
  OpportunityRepositoryPort,
} from '../opportunity/domain/ports/opportunity.repository.port';
import { SEARCH_INDEX_PORT, SearchIndexPort } from '../opportunity/domain/ports/search-index.port';
import { ANALYSIS_QUEUE_PORT, AnalysisQueuePort } from '../opportunity/domain/ports/analysis-queue.port';
import { REFRESH_RECOMMENDATIONS_QUEUE_NAME } from './infrastructure/adapters/queue/bullmq-recommendation-refresh-queue.adapter';
import { RefreshRecommendationsJob } from './infrastructure/jobs/refresh-recommendations.job';

@Module({
  imports: [
    AiModule,
    ProfileModule,
    OpportunityModule,
    BullModule.registerQueue({ name: REFRESH_RECOMMENDATIONS_QUEUE_NAME }),
  ],
  controllers: [RecommendationController, ProfileRecommendationsController],
  providers: [
    {
      provide: RECOMMENDATION_REPOSITORY_PORT,
      useFactory: (pool: Pool) => new PostgresRecommendationRepository(pool),
      inject: [DATABASE_POOL],
    },
    {
      provide: WATCH_REPOSITORY_PORT,
      useFactory: (pool: Pool) => new PostgresWatchRepository(pool),
      inject: [DATABASE_POOL],
    },
    {
      provide: MatchingService,
      useFactory: () => new MatchingService(),
    },
    {
      provide: RefreshRecommendationsUseCase,
      useFactory: (
        profileRepo,
        oppRepo,
        recRepo,
        matchingService: MatchingService,
        embedder: EmbedderPort,
        searchIndex: SearchIndexPort,
        analysisQueue: AnalysisQueuePort,
      ) =>
        new RefreshRecommendationsUseCase(
          profileRepo,
          oppRepo,
          recRepo,
          matchingService,
          embedder,
          searchIndex,
          undefined,
          analysisQueue,
        ),
      inject: [
        PROFILE_REPOSITORY_PORT,
        OPPORTUNITY_REPOSITORY_PORT,
        RECOMMENDATION_REPOSITORY_PORT,
        MatchingService,
        EMBEDDER_PORT,
        SEARCH_INDEX_PORT,
        ANALYSIS_QUEUE_PORT,
      ],
    },
    RefreshRecommendationsJob,
    {
      provide: GetRecommendationsUseCase,
      useFactory: (profileRepo, recRepo) =>
        new GetRecommendationsUseCase(profileRepo, recRepo),
      inject: [PROFILE_REPOSITORY_PORT, RECOMMENDATION_REPOSITORY_PORT],
    },
    {
      provide: GetRecommendationFeedUseCase,
      useFactory: (recRepo: RecommendationRepositoryPort) =>
        new GetRecommendationFeedUseCase(recRepo),
      inject: [RECOMMENDATION_REPOSITORY_PORT],
    },
    {
      provide: RegisterFeedbackUseCase,
      useFactory: (recRepo: RecommendationRepositoryPort) =>
        new RegisterFeedbackUseCase(recRepo),
      inject: [RECOMMENDATION_REPOSITORY_PORT],
    },
    {
      provide: UndoFeedbackUseCase,
      useFactory: (recRepo: RecommendationRepositoryPort) =>
        new UndoFeedbackUseCase(recRepo),
      inject: [RECOMMENDATION_REPOSITORY_PORT],
    },
    {
      provide: WatchOpportunityUseCase,
      useFactory: (
        watchRepo: WatchRepositoryPort,
        profileRepo: ProfileRepositoryPort,
        oppRepo: OpportunityRepositoryPort,
      ) => new WatchOpportunityUseCase(watchRepo, profileRepo, oppRepo),
      inject: [WATCH_REPOSITORY_PORT, PROFILE_REPOSITORY_PORT, OPPORTUNITY_REPOSITORY_PORT],
    },
    {
      provide: UnwatchOpportunityUseCase,
      useFactory: (
        watchRepo: WatchRepositoryPort,
        profileRepo: ProfileRepositoryPort,
      ) => new UnwatchOpportunityUseCase(watchRepo, profileRepo),
      inject: [WATCH_REPOSITORY_PORT, PROFILE_REPOSITORY_PORT],
    },
    {
      provide: GetWatchedOpportunitiesUseCase,
      useFactory: (
        watchRepo: WatchRepositoryPort,
        profileRepo: ProfileRepositoryPort,
      ) => new GetWatchedOpportunitiesUseCase(watchRepo, profileRepo),
      inject: [WATCH_REPOSITORY_PORT, PROFILE_REPOSITORY_PORT],
    },
    {
      provide: GetProfileSummaryUseCase,
      useFactory: (watchRepo: WatchRepositoryPort) =>
        new GetProfileSummaryUseCase(watchRepo),
      inject: [WATCH_REPOSITORY_PORT],
    },
  ],
  exports: [
    RECOMMENDATION_REPOSITORY_PORT,
    WATCH_REPOSITORY_PORT,
    MatchingService,
    RefreshRecommendationsUseCase,
    GetRecommendationsUseCase,
    GetRecommendationFeedUseCase,
    RegisterFeedbackUseCase,
    UndoFeedbackUseCase,
    WatchOpportunityUseCase,
    UnwatchOpportunityUseCase,
    GetWatchedOpportunitiesUseCase,
    GetProfileSummaryUseCase,
  ],
})
export class RecommendationModule {}
