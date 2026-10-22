import {
  Inject,
  Injectable,
  Logger,
  LoggerService,
  Optional,
} from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ADMIN_TASKS_QUEUE_NAME } from '../../domain/ports/admin-queue.port';
import { SyncOpportunitiesUseCase } from '../../../opportunity/application/use-cases/sync-opportunities.use-case';
import { ReviewFollowUpUseCase } from '../../../alert/application/use-cases/review-follow-up.use-case';
import {
  RECOMMENDATION_REFRESH_QUEUE_PORT,
  RecommendationRefreshQueuePort,
} from '../../../recommendation/domain/ports/recommendation-refresh-queue.port';
import { ENV, Env } from '../../../../config/env';

@Processor(ADMIN_TASKS_QUEUE_NAME, { concurrency: 2 })
@Injectable()
export class AdminTaskProcessor extends WorkerHost {
  private readonly logger: LoggerService;

  constructor(
    @Optional()
    @Inject(SyncOpportunitiesUseCase)
    private readonly syncOpportunitiesUseCase?: SyncOpportunitiesUseCase,
    @Optional()
    @Inject(ReviewFollowUpUseCase)
    private readonly reviewFollowUpUseCase?: ReviewFollowUpUseCase,
    @Optional()
    @Inject(RECOMMENDATION_REFRESH_QUEUE_PORT)
    private readonly refreshQueue?: RecommendationRefreshQueuePort,
    @Optional()
    @Inject('ADMIN_PROCESSOR_LOGGER')
    logger?: LoggerService,
    @Optional()
    @Inject(ENV)
    private readonly env?: Env,
  ) {
    super();
    this.logger = logger ?? new Logger(AdminTaskProcessor.name);
  }

  async process(job: Job): Promise<any> {
    this.logger.log(`Processing admin task ${job.name} (id: ${job.id})`);

    switch (job.name) {
      case 'admin-sync': {
        if (!this.syncOpportunitiesUseCase) {
          throw new Error(
            'SyncOpportunitiesUseCase not available in AdminTaskProcessor',
          );
        }
        const sinceDate = job.data?.since
          ? new Date(job.data.since)
          : undefined;
        const maxRecords =
          job.data?.maxRecords ?? this.env?.SECOP_SYNC_MAX_RECORDS ?? 5000;
        const result = await this.syncOpportunitiesUseCase.execute({
          since: sinceDate,
          maxRecords,
        });

        if (!result.ok) {
          throw new Error(`Source ${result.error.sourceName} is unavailable`);
        }

        if (
          (result.value.created > 0 || result.value.updated > 0) &&
          !result.value.refreshTriggered &&
          this.refreshQueue?.enqueueRefreshForAllProfiles
        ) {
          await this.refreshQueue.enqueueRefreshForAllProfiles();
        }

        return result.value;
      }

      case 'admin-alerts-run': {
        if (!this.reviewFollowUpUseCase) {
          throw new Error(
            'ReviewFollowUpUseCase not available in AdminTaskProcessor',
          );
        }
        const result = await this.reviewFollowUpUseCase.execute();
        if (!result.ok) {
          throw new Error('ReviewFollowUp failed');
        }
        return result.value;
      }

      case 'admin-recommendations-refresh': {
        if (!this.refreshQueue?.enqueueRefreshForAllProfiles) {
          return { profilesRefreshed: 0 };
        }
        const count = await this.refreshQueue.enqueueRefreshForAllProfiles();
        return { profilesRefreshed: count };
      }

      default:
        throw new Error(`Unknown admin task ${job.name}`);
    }
  }
}
