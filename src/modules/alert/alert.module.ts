import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../shared/infrastructure/persistence/database.module';
import { ALERT_REPOSITORY_PORT } from './domain/ports/alert.repository.port';
import { NOTIFICATION_PORT } from './domain/ports/notification.port';
import { PostgresAlertRepository } from './infrastructure/adapters/persistence/postgres-alert.repository';
import { EmailAdapter } from './infrastructure/adapters/email/email.adapter';
import { ReviewFollowUpUseCase } from './application/use-cases/review-follow-up.use-case';
import { ScanDeadlinesUseCase } from './application/use-cases/scan-deadlines.use-case';
import { Clock, CLOCK_PORT, SystemClock } from '../shared/domain/clock';
import { AlertController } from './infrastructure/controllers/alert.controller';
import { AlertRepositoryPort } from './domain/ports/alert.repository.port';

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
      provide: CLOCK_PORT,
      useClass: SystemClock,
    },
    {
      provide: ReviewFollowUpUseCase,
      useFactory: (alertRepo, notifPort) => new ReviewFollowUpUseCase(alertRepo, notifPort),
      inject: [ALERT_REPOSITORY_PORT, NOTIFICATION_PORT],
    },
    {
      provide: ScanDeadlinesUseCase,
      useFactory: (pool: Pool, alertRepo: AlertRepositoryPort, clock?: Clock) =>
        new ScanDeadlinesUseCase(pool, alertRepo, clock),
      inject: [DATABASE_POOL, ALERT_REPOSITORY_PORT, CLOCK_PORT],
    },
  ],
  exports: [
    ALERT_REPOSITORY_PORT,
    NOTIFICATION_PORT,
    CLOCK_PORT,
    ReviewFollowUpUseCase,
    ScanDeadlinesUseCase,
  ],
})
export class AlertModule {}
