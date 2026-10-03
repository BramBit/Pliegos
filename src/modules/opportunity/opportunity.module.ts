import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { Queue } from 'bullmq';
import { DATABASE_POOL } from '../shared/infrastructure/persistence/database.module';
import { AiModule } from '../shared/infrastructure/ai/ai.module';
import { AI_PROVIDER_PORT, AIProviderPort } from '../recommendation/domain/ports/ai-provider.port';
import { OPPORTUNITY_REPOSITORY_PORT } from './domain/ports/opportunity.repository.port';
import { OPPORTUNITY_SOURCE_PORT } from './domain/ports/opportunity-source.port';
import { SEARCH_INDEX_PORT } from './domain/ports/search-index.port';
import { ANALYSIS_QUEUE_PORT } from './domain/ports/analysis-queue.port';
import { PostgresOpportunityRepository } from './infrastructure/adapters/persistence/postgres-opportunity.repository';
import { SecopAdapter } from './infrastructure/adapters/secop/secop.adapter';
import { PgVectorAdapter } from './infrastructure/adapters/search/pgvector.adapter';
import {
  BullMQAnalysisQueueAdapter,
  ANALYSIS_QUEUE_NAME,
} from './infrastructure/adapters/queue/bullmq-analysis-queue.adapter';
import { SyncOpportunitiesUseCase } from './application/use-cases/sync-opportunities.use-case';
import { SearchOpportunitiesUseCase } from './application/use-cases/search-opportunities.use-case';
import { OpportunityController } from './infrastructure/controllers/opportunity.controller';

@Module({
  imports: [AiModule],
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
      useFactory: (pool: Pool, aiProvider: AIProviderPort) => {
        return new PgVectorAdapter({ pool, aiProvider });
      },
      inject: [DATABASE_POOL, AI_PROVIDER_PORT],
    },
    {
      provide: ANALYSIS_QUEUE_PORT,
      useFactory: () => {
        const queue = new Queue(ANALYSIS_QUEUE_NAME, {
          connection: {
            host: process.env.REDIS_HOST || 'localhost',
            port: Number(process.env.REDIS_PORT) || 6379,
            maxRetriesPerRequest: null,
          },
        });
        return new BullMQAnalysisQueueAdapter(queue);
      },
    },
    {
      provide: SyncOpportunitiesUseCase,
      useFactory: (source, repo, queue) => new SyncOpportunitiesUseCase(source, repo, queue),
      inject: [OPPORTUNITY_SOURCE_PORT, OPPORTUNITY_REPOSITORY_PORT, ANALYSIS_QUEUE_PORT],
    },
    {
      provide: SearchOpportunitiesUseCase,
      useFactory: (repo, searchIndex, aiProvider) =>
        new SearchOpportunitiesUseCase(repo, searchIndex, aiProvider),
      inject: [OPPORTUNITY_REPOSITORY_PORT, SEARCH_INDEX_PORT, AI_PROVIDER_PORT],
    },
  ],
  exports: [
    OPPORTUNITY_REPOSITORY_PORT,
    SEARCH_INDEX_PORT,
    ANALYSIS_QUEUE_PORT,
    SyncOpportunitiesUseCase,
    SearchOpportunitiesUseCase,
  ],
})
export class OpportunityModule {}
