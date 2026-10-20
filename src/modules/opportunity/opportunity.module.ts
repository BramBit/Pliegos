import { Module, forwardRef } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../shared/infrastructure/persistence/database.module';
import { AiModule } from '../shared/infrastructure/ai/ai.module';
import { EMBEDDER_PORT, EmbedderPort } from '../recommendation/domain/ports/ai-provider.port';
import { OPPORTUNITY_REPOSITORY_PORT } from './domain/ports/opportunity.repository.port';
import { OPPORTUNITY_SOURCE_PORT } from './domain/ports/opportunity-source.port';
import { SEARCH_INDEX_PORT } from './domain/ports/search-index.port';
import { ANALYSIS_QUEUE_PORT } from './domain/ports/analysis-queue.port';
import { WATCH_REPOSITORY_PORT, WatchRepositoryPort } from '../recommendation/domain/ports/watch.repository.port';
import { ALERT_REPOSITORY_PORT, AlertRepositoryPort } from '../alert/domain/ports/alert.repository.port';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { AlertModule } from '../alert/alert.module';
import { PostgresOpportunityRepository } from './infrastructure/adapters/persistence/postgres-opportunity.repository';
import { SecopAdapter } from './infrastructure/adapters/secop/secop.adapter';
import { PgVectorAdapter } from './infrastructure/adapters/search/pgvector.adapter';
import {
  BullMQAnalysisQueueAdapter,
  ANALYSIS_QUEUE_NAME,
} from './infrastructure/adapters/queue/bullmq-analysis-queue.adapter';
import {
  BullMQRecommendationRefreshQueueAdapter,
  REFRESH_RECOMMENDATIONS_QUEUE_NAME,
} from '../recommendation/infrastructure/adapters/queue/bullmq-recommendation-refresh-queue.adapter';
import { SyncOpportunitiesUseCase } from './application/use-cases/sync-opportunities.use-case';
import { SearchOpportunitiesUseCase } from './application/use-cases/search-opportunities.use-case';
import { GetOpportunityByIdUseCase } from './application/use-cases/get-opportunity-by-id.use-case';
import { AnalyzeOpportunityJob } from './infrastructure/jobs/analyze-opportunity.job';
import { OpportunityController } from './infrastructure/controllers/opportunity.controller';

@Module({
  imports: [
    AiModule,
    AlertModule,
    forwardRef(() => RecommendationModule),
    BullModule.registerQueue(
      { name: ANALYSIS_QUEUE_NAME },
      { name: REFRESH_RECOMMENDATIONS_QUEUE_NAME },
    ),
  ],
  controllers: [OpportunityController],
  providers: [
    {
      provide: OPPORTUNITY_REPOSITORY_PORT,
      useFactory: (pool: Pool) => new PostgresOpportunityRepository(pool),
      inject: [DATABASE_POOL],
    },
    {
      provide: OPPORTUNITY_SOURCE_PORT,
      useFactory: () => new SecopAdapter(),
    },
    {
      provide: SEARCH_INDEX_PORT,
      useFactory: (pool: Pool, embedder: EmbedderPort) => {
        return new PgVectorAdapter({ pool, embedder });
      },
      inject: [DATABASE_POOL, EMBEDDER_PORT],
    },
    {
      provide: ANALYSIS_QUEUE_PORT,
      useFactory: (queue: Queue) => new BullMQAnalysisQueueAdapter(queue),
      inject: [getQueueToken(ANALYSIS_QUEUE_NAME)],
    },
    ...(process.env.ROLE !== 'api' ? [AnalyzeOpportunityJob] : []),
    {
      provide: SyncOpportunitiesUseCase,
      useFactory: (
        source,
        repo,
        queue,
        refreshQueueRaw,
        watchRepo: WatchRepositoryPort,
        alertRepo: AlertRepositoryPort,
      ) => {
        const refreshQueue = new BullMQRecommendationRefreshQueueAdapter(refreshQueueRaw);
        return new SyncOpportunitiesUseCase(
          source,
          repo,
          queue,
          undefined,
          refreshQueue,
          watchRepo,
          alertRepo,
        );
      },
      inject: [
        OPPORTUNITY_SOURCE_PORT,
        OPPORTUNITY_REPOSITORY_PORT,
        ANALYSIS_QUEUE_PORT,
        getQueueToken(REFRESH_RECOMMENDATIONS_QUEUE_NAME),
        WATCH_REPOSITORY_PORT,
        ALERT_REPOSITORY_PORT,
      ],
    },
    {
      provide: SearchOpportunitiesUseCase,
      useFactory: (repo, searchIndex, embedder: EmbedderPort) =>
        new SearchOpportunitiesUseCase(repo, searchIndex, embedder),
      inject: [OPPORTUNITY_REPOSITORY_PORT, SEARCH_INDEX_PORT, EMBEDDER_PORT],
    },
    {
      provide: GetOpportunityByIdUseCase,
      useFactory: (repo, queue) => new GetOpportunityByIdUseCase(repo, queue),
      inject: [OPPORTUNITY_REPOSITORY_PORT, ANALYSIS_QUEUE_PORT],
    },
  ],
  exports: [
    OPPORTUNITY_REPOSITORY_PORT,
    SEARCH_INDEX_PORT,
    ANALYSIS_QUEUE_PORT,
    SyncOpportunitiesUseCase,
    SearchOpportunitiesUseCase,
    GetOpportunityByIdUseCase,
  ],
})
export class OpportunityModule {}
