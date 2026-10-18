import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SyncOpportunitiesUseCase } from '../opportunity/application/use-cases/sync-opportunities.use-case';
import { ReviewFollowUpUseCase } from '../alert/application/use-cases/review-follow-up.use-case';
import {
  RECOMMENDATION_REFRESH_QUEUE_PORT,
  RecommendationRefreshQueuePort,
} from '../recommendation/domain/ports/recommendation-refresh-queue.port';

export const SYNC_OPPORTUNITIES_CRON =
  process.env.SYNC_OPPORTUNITIES_CRON || CronExpression.EVERY_4_HOURS;

export const REVIEW_FOLLOW_UP_CRON =
  process.env.REVIEW_FOLLOW_UP_CRON || CronExpression.EVERY_DAY_AT_8AM;

export const SYNC_OPPORTUNITIES_JOB_NAME = 'sync-opportunities';
export const REVIEW_FOLLOW_UP_JOB_NAME = 'review-follow-up';

/**
 * Driving adapter for scheduled background jobs (technical design §8).
 * Triggers domain use cases on defined cron intervals without HTTP interaction.
 */
@Injectable()
export class SchedulerAdapter {
  private readonly logger = new Logger(SchedulerAdapter.name);

  constructor(
    private readonly syncOpportunitiesUseCase: SyncOpportunitiesUseCase,
    private readonly reviewFollowUpUseCase: ReviewFollowUpUseCase,
    @Optional()
    @Inject(RECOMMENDATION_REFRESH_QUEUE_PORT)
    private readonly refreshQueue?: RecommendationRefreshQueuePort,
  ) {}

  /**
   * Periodically synchronizes latest public opportunities from SECOP II.
   * Default: Every 4 hours (0 0-23/4 * * *).
   */
  @Cron(SYNC_OPPORTUNITIES_CRON, {
    name: SYNC_OPPORTUNITIES_JOB_NAME,
  })
  async handleSyncOpportunities(): Promise<void> {
    this.logger.log('Executing scheduled job: SyncOpportunities');
    try {
      const result = await this.syncOpportunitiesUseCase.execute({
        maxRecords: Number(process.env.SECOP_SYNC_MAX_RECORDS) || 5000,
      });
      if (result.ok) {
        this.logger.log(
          `Scheduled sync completed: ${result.value.created} created, ${result.value.updated} updated`,
        );
        if (
          (result.value.created > 0 || result.value.updated > 0) &&
          !result.value.refreshTriggered &&
          this.refreshQueue?.enqueueRefreshForAllProfiles
        ) {
          await this.refreshQueue.enqueueRefreshForAllProfiles();
        }
      } else {
        this.logger.warn(
          `Scheduled sync failed: source unavailable (${result.error.sourceName})`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Scheduled sync threw unexpected exception: ${message}`);
    }
  }

  /**
   * Periodically scans undelivered alerts (deadlines approaching, amendments, status changes)
   * and delivers notifications via NotificationPort.
   * Default: Daily at 8:00 AM (0 08 * * *).
   */
  @Cron(REVIEW_FOLLOW_UP_CRON, {
    name: REVIEW_FOLLOW_UP_JOB_NAME,
  })
  async handleReviewFollowUp(): Promise<void> {
    this.logger.log('Executing scheduled job: ReviewFollowUp');
    try {
      const result = await this.reviewFollowUpUseCase.execute();
      if (result.ok) {
        this.logger.log(
          `Scheduled review follow-up completed: ${result.value.alertsSent} alerts sent`,
        );
      } else {
        this.logger.warn('Scheduled review follow-up failed');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Scheduled review follow-up threw unexpected exception: ${message}`);
    }
  }
}
