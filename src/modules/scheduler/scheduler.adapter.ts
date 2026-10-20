import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SyncOpportunitiesUseCase } from '../opportunity/application/use-cases/sync-opportunities.use-case';
import { ReviewFollowUpUseCase } from '../alert/application/use-cases/review-follow-up.use-case';
import { ScanDeadlinesUseCase } from '../alert/application/use-cases/scan-deadlines.use-case';
import {
  RECOMMENDATION_REFRESH_QUEUE_PORT,
  RecommendationRefreshQueuePort,
} from '../recommendation/domain/ports/recommendation-refresh-queue.port';
import {
  PIPELINE_RUN_REPOSITORY_PORT,
  PipelineRunRepositoryPort,
} from '../admin/domain/ports/pipeline-run-repository.port';

export const SYNC_OPPORTUNITIES_CRON =
  process.env.SYNC_OPPORTUNITIES_CRON || CronExpression.EVERY_4_HOURS;

export const REVIEW_FOLLOW_UP_CRON =
  process.env.REVIEW_FOLLOW_UP_CRON || CronExpression.EVERY_DAY_AT_8AM;

export const SCAN_DEADLINES_CRON =
  process.env.SCAN_DEADLINES_CRON || '30 07 * * *';

export const SYNC_OPPORTUNITIES_JOB_NAME = 'sync-opportunities';
export const REVIEW_FOLLOW_UP_JOB_NAME = 'review-follow-up';
export const SCAN_DEADLINES_JOB_NAME = 'scan-deadlines';

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
    @Optional()
    private readonly scanDeadlinesUseCase?: ScanDeadlinesUseCase,
    @Optional()
    @Inject(PIPELINE_RUN_REPOSITORY_PORT)
    private readonly pipelineRunRepository?: PipelineRunRepositoryPort,
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
    let runId: string | undefined;
    if (this.pipelineRunRepository) {
      try {
        runId = await this.pipelineRunRepository.startRun('sync');
      } catch (err) {
        this.logger.warn(`Failed to record pipeline run start: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

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
        if (runId && this.pipelineRunRepository) {
          await this.pipelineRunRepository.completeRun(runId, {
            created: result.value.created,
            updated: result.value.updated,
          });
        }
      } else {
        const errorMsg = `Source unavailable (${result.error.sourceName})`;
        this.logger.warn(`Scheduled sync failed: ${errorMsg}`);
        if (runId && this.pipelineRunRepository) {
          await this.pipelineRunRepository.failRun(runId, errorMsg);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Scheduled sync threw unexpected exception: ${message}`);
      if (runId && this.pipelineRunRepository) {
        await this.pipelineRunRepository.failRun(runId, message);
      }
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
    let runId: string | undefined;
    if (this.pipelineRunRepository) {
      try {
        runId = await this.pipelineRunRepository.startRun('alerts');
      } catch (err) {
        this.logger.warn(`Failed to record pipeline run start: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      const result = await this.reviewFollowUpUseCase.execute();
      if (result.ok) {
        this.logger.log(
          `Scheduled review follow-up completed: ${result.value.alertsSent} alerts sent`,
        );
        if (runId && this.pipelineRunRepository) {
          await this.pipelineRunRepository.completeRun(runId, {
            alertsSent: result.value.alertsSent,
          });
        }
      } else {
        this.logger.warn('Scheduled review follow-up failed');
        if (runId && this.pipelineRunRepository) {
          await this.pipelineRunRepository.failRun(runId, 'Review follow-up failed');
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Scheduled review follow-up threw unexpected exception: ${message}`);
      if (runId && this.pipelineRunRepository) {
        await this.pipelineRunRepository.failRun(runId, message);
      }
    }
  }

  /**
   * Periodically scans watched opportunities (and optionally top 5 new recommendations)
   * approaching their submission deadlines and creates DeadlineApproaching alerts under an advisory lock.
   * Default: Daily at 7:30 AM (30 07 * * *).
   */
  @Cron(SCAN_DEADLINES_CRON, {
    name: SCAN_DEADLINES_JOB_NAME,
  })
  async handleScanDeadlines(): Promise<void> {
    if (!this.scanDeadlinesUseCase) return;
    this.logger.log('Executing scheduled job: ScanDeadlines');
    let runId: string | undefined;
    if (this.pipelineRunRepository) {
      try {
        runId = await this.pipelineRunRepository.startRun('deadlines');
      } catch (err) {
        this.logger.warn(`Failed to record pipeline run start: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      const result = await this.scanDeadlinesUseCase.execute();
      if (result.ok) {
        if (result.value.skipped) {
          this.logger.log(`Scheduled scan deadlines skipped: ${result.value.reason}`);
        } else {
          this.logger.log(
            `Scheduled scan deadlines completed: ${result.value.alertsCreated} alerts created`,
          );
        }
        if (runId && this.pipelineRunRepository) {
          await this.pipelineRunRepository.completeRun(runId, {
            alertsCreated: result.value.alertsCreated,
            skipped: result.value.skipped,
            reason: result.value.reason,
          });
        }
      } else {
        this.logger.warn(`Scheduled scan deadlines failed: ${result.error.message}`);
        if (runId && this.pipelineRunRepository) {
          await this.pipelineRunRepository.failRun(runId, result.error.message);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Scheduled scan deadlines threw unexpected exception: ${message}`);
      if (runId && this.pipelineRunRepository) {
        await this.pipelineRunRepository.failRun(runId, message);
      }
    }
  }
}
