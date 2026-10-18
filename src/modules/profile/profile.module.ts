import { Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../shared/infrastructure/persistence/database.module';
import { PROFILE_REPOSITORY_PORT } from './domain/ports/profile.repository.port';
import { PostgresProfileRepository } from './infrastructure/adapters/persistence/postgres-profile.repository';
import { ConfigureProfileUseCase } from './application/use-cases/configure-profile.use-case';
import { ProfileController } from './infrastructure/controllers/profile.controller';
import {
  RECOMMENDATION_REFRESH_QUEUE_PORT,
  RecommendationRefreshQueuePort,
} from '../recommendation/domain/ports/recommendation-refresh-queue.port';
import {
  BullMQRecommendationRefreshQueueAdapter,
  REFRESH_RECOMMENDATIONS_QUEUE_NAME,
} from '../recommendation/infrastructure/adapters/queue/bullmq-recommendation-refresh-queue.adapter';

@Module({
  imports: [BullModule.registerQueue({ name: REFRESH_RECOMMENDATIONS_QUEUE_NAME })],
  controllers: [ProfileController],
  providers: [
    {
      provide: PROFILE_REPOSITORY_PORT,
      useFactory: (pool: Pool) => new PostgresProfileRepository(pool),
      inject: [DATABASE_POOL],
    },
    {
      provide: RECOMMENDATION_REFRESH_QUEUE_PORT,
      useFactory: (queue: Queue, pool: Pool) =>
        new BullMQRecommendationRefreshQueueAdapter(queue, pool),
      inject: [getQueueToken(REFRESH_RECOMMENDATIONS_QUEUE_NAME), DATABASE_POOL],
    },
    {
      provide: ConfigureProfileUseCase,
      useFactory: (repo, refreshQueue: RecommendationRefreshQueuePort) =>
        new ConfigureProfileUseCase(repo, refreshQueue),
      inject: [PROFILE_REPOSITORY_PORT, RECOMMENDATION_REFRESH_QUEUE_PORT],
    },
  ],
  exports: [
    PROFILE_REPOSITORY_PORT,
    RECOMMENDATION_REFRESH_QUEUE_PORT,
    ConfigureProfileUseCase,
  ],
})
export class ProfileModule {}
