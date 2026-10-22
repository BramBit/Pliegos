import {
  Inject,
  Injectable,
  Logger,
  LoggerService,
  Optional,
} from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  REFRESH_RECOMMENDATIONS_QUEUE_NAME,
  RefreshRecommendationsJobPayload,
} from '../adapters/queue/bullmq-recommendation-refresh-queue.adapter';
import { RefreshRecommendationsUseCase } from '../../application/use-cases/refresh-recommendations.use-case';

export interface IRefreshJobLike {
  readonly id?: string;
  readonly data: RefreshRecommendationsJobPayload;
}

@Processor(REFRESH_RECOMMENDATIONS_QUEUE_NAME, { concurrency: 1 })
@Injectable()
export class RefreshRecommendationsJob extends WorkerHost {
  private readonly logger: LoggerService;

  constructor(
    @Inject(RefreshRecommendationsUseCase)
    private readonly refreshUseCase: RefreshRecommendationsUseCase,
    @Optional() @Inject('REFRESH_JOB_LOGGER') logger?: LoggerService,
  ) {
    super();
    this.logger = logger ?? new Logger(RefreshRecommendationsJob.name);
  }

  async process(job: IRefreshJobLike): Promise<void> {
    const { profileId } = job.data;
    this.logger.log(
      `Processing refresh-recommendations job ${job.id ?? 'unknown'} for Profile ${profileId}`,
    );

    const result = await this.refreshUseCase.execute({ profileId });
    if (!result.ok) {
      this.logger.warn(
        `Profile ${profileId} not found during refresh-recommendations job ${job.id ?? 'unknown'}. Skipping.`,
      );
      return;
    }

    this.logger.log(
      `Completed refresh-recommendations for Profile ${profileId}: candidates=${result.value.run.candidates} kept=${result.value.run.kept} level=${result.value.run.level} degraded=${result.value.run.degraded}`,
    );
  }
}
