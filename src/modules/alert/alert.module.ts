import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../shared/infrastructure/persistence/database.module';
import { ALERT_REPOSITORY_PORT, AlertRepositoryPort } from './domain/ports/alert.repository.port';
import { NOTIFICATION_PORT, NotificationPort } from './domain/ports/notification.port';
import { PostgresAlertRepository } from './infrastructure/adapters/persistence/postgres-alert.repository';
import { SmtpEmailAdapter } from './infrastructure/adapters/email/smtp-email.adapter';
import { ReviewFollowUpUseCase } from './application/use-cases/review-follow-up.use-case';
import { ScanDeadlinesUseCase } from './application/use-cases/scan-deadlines.use-case';
import { Clock, CLOCK_PORT, SystemClock } from '../shared/domain/clock';
import { AlertController } from './infrastructure/controllers/alert.controller';
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
  controllers: [AlertController],
  providers: [
    {
      provide: ALERT_REPOSITORY_PORT,
      useFactory: (pool: Pool) => new PostgresAlertRepository(pool),
      inject: [DATABASE_POOL],
    },
    {
      provide: NOTIFICATION_PORT,
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('SMTP_HOST') || 'localhost';
        const port = Number(config.get('SMTP_PORT')) || 1025;
        const user = config.get<string>('SMTP_USER') || undefined;
        const pass = config.get<string>('SMTP_PASS') || undefined;
        const from = config.get<string>('SMTP_FROM') || 'Pliegos <alertas@pliegos.co>';
        const secureRaw = config.get('SMTP_SECURE');
        const secure = secureRaw === 'true' || secureRaw === true;

        return new SmtpEmailAdapter({
          config: {
            host,
            port,
            user,
            pass,
            from,
            secure,
          },
        });
      },
      inject: [ConfigService],
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
