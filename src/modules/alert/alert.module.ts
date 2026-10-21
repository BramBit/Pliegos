import { Module, forwardRef } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../shared/infrastructure/persistence/database.module';
import { ALERT_REPOSITORY_PORT, AlertRepositoryPort } from './domain/ports/alert.repository.port';
import { NOTIFICATION_PORT, NotificationPort } from './domain/ports/notification.port';
import { PostgresAlertRepository } from './infrastructure/adapters/persistence/postgres-alert.repository';
import { SmtpEmailAdapter } from './infrastructure/adapters/email/smtp-email.adapter';
import { ReviewFollowUpUseCase } from './application/use-cases/review-follow-up.use-case';
import { ScanDeadlinesUseCase } from './application/use-cases/scan-deadlines.use-case';
import { GetProfileAlertsUseCase } from './application/use-cases/get-profile-alerts.use-case';
import { MarkAlertReadUseCase } from './application/use-cases/mark-alert-read.use-case';
import { MarkAllAlertsReadUseCase } from './application/use-cases/mark-all-alerts-read.use-case';
import { Clock, CLOCK_PORT, SystemClock } from '../shared/domain/clock';
import { AlertController } from './infrastructure/controllers/alert.controller';
import { ProfileAlertsController } from './infrastructure/controllers/profile-alerts.controller';
import { ENV, Env } from '../../config/env';
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

@Module({
  imports: [ProfileModule, forwardRef(() => OpportunityModule)],
  controllers: [AlertController, ProfileAlertsController],
  providers: [
    {
      provide: ALERT_REPOSITORY_PORT,
      useFactory: (pool: Pool) => new PostgresAlertRepository(pool),
      inject: [DATABASE_POOL],
    },
    {
      provide: NOTIFICATION_PORT,
      inject: [ENV],
      useFactory: (env: Env) => {
        return new SmtpEmailAdapter({
          config: {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            user: env.SMTP_USER || undefined,
            pass: env.SMTP_PASS || undefined,
            from: env.SMTP_FROM,
            secure: env.SMTP_SECURE,
          },
        });
      },
    },
    {
      provide: CLOCK_PORT,
      useClass: SystemClock,
    },
    {
      provide: ReviewFollowUpUseCase,
      useFactory: (
        alertRepo: AlertRepositoryPort,
        notifPort: NotificationPort,
        profileRepo: ProfileRepositoryPort,
        oppRepo: OpportunityRepositoryPort,
      ) => new ReviewFollowUpUseCase(alertRepo, notifPort, profileRepo, oppRepo),
      inject: [
        ALERT_REPOSITORY_PORT,
        NOTIFICATION_PORT,
        PROFILE_REPOSITORY_PORT,
        OPPORTUNITY_REPOSITORY_PORT,
      ],
    },
    {
      provide: ScanDeadlinesUseCase,
      useFactory: (pool: Pool, alertRepo: AlertRepositoryPort, clock: Clock, env: Env) =>
        new ScanDeadlinesUseCase(pool, alertRepo, clock, undefined, env.RECOMMEND_DEADLINE_ALERTS),
      inject: [DATABASE_POOL, ALERT_REPOSITORY_PORT, CLOCK_PORT, ENV],
    },
    {
      provide: GetProfileAlertsUseCase,
      useFactory: (alertRepo: AlertRepositoryPort) => new GetProfileAlertsUseCase(alertRepo),
      inject: [ALERT_REPOSITORY_PORT],
    },
    {
      provide: MarkAlertReadUseCase,
      useFactory: (alertRepo: AlertRepositoryPort) => new MarkAlertReadUseCase(alertRepo),
      inject: [ALERT_REPOSITORY_PORT],
    },
    {
      provide: MarkAllAlertsReadUseCase,
      useFactory: (alertRepo: AlertRepositoryPort) => new MarkAllAlertsReadUseCase(alertRepo),
      inject: [ALERT_REPOSITORY_PORT],
    },
  ],
  exports: [
    ALERT_REPOSITORY_PORT,
    NOTIFICATION_PORT,
    CLOCK_PORT,
    ReviewFollowUpUseCase,
    ScanDeadlinesUseCase,
    GetProfileAlertsUseCase,
    MarkAlertReadUseCase,
    MarkAllAlertsReadUseCase,
  ],
})
export class AlertModule {}
