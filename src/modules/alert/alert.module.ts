import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../shared/infrastructure/persistence/database.module';
import { ALERT_REPOSITORY_PORT } from './domain/ports/alert.repository.port';
import { NOTIFICATION_PORT } from './domain/ports/notification.port';
import { PostgresAlertRepository } from './infrastructure/adapters/persistence/postgres-alert.repository';
import { EmailAdapter } from './infrastructure/adapters/email/email.adapter';
import { ReviewFollowUpUseCase } from './application/use-cases/review-follow-up.use-case';
import { AlertController } from './infrastructure/controllers/alert.controller';

@Module({
  controllers: [AlertController],
  providers: [
    {
      provide: ALERT_REPOSITORY_PORT,
      useFactory: (pool: Pool) => new PostgresAlertRepository(pool),
      inject: [DATABASE_POOL],
    },
    {
      provide: NOTIFICATION_PORT,
      useFactory: () => new EmailAdapter(),
    },
    {
      provide: ReviewFollowUpUseCase,
      useFactory: (alertRepo, notifPort) => new ReviewFollowUpUseCase(alertRepo, notifPort),
      inject: [ALERT_REPOSITORY_PORT, NOTIFICATION_PORT],
    },
  ],
  exports: [ALERT_REPOSITORY_PORT, NOTIFICATION_PORT, ReviewFollowUpUseCase],
})
export class AlertModule {}
