import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { Pool } from 'pg';
import { RecommendationRefreshQueuePort } from '../../../domain/ports/recommendation-refresh-queue.port';
import { ProfileId, asProfileId } from '../../../../shared/domain/typed-id';

export const REFRESH_RECOMMENDATIONS_QUEUE_NAME = 'refresh-recommendations';
export const REFRESH_RECOMMENDATIONS_JOB_NAME = 'refresh-recommendations';

export interface RefreshRecommendationsJobPayload {
  readonly profileId: ProfileId;
}

export interface IRefreshQueueLike {
  add(
    name: string,
    data: RefreshRecommendationsJobPayload,
    opts?: {
      jobId?: string;
      attempts?: number;
      backoff?: { type: 'exponential' | 'fixed'; delay: number };
      removeOnComplete?: boolean | number;
      removeOnFail?: boolean | number;
    },
  ): Promise<{ id?: string }>;
}

@Injectable()
export class BullMQRecommendationRefreshQueueAdapter
  implements RecommendationRefreshQueuePort
{
  private readonly logger: LoggerService;

  constructor(
    private readonly queue: IRefreshQueueLike,
    private readonly pool?: Pool,
    logger?: LoggerService,
  ) {
    this.logger = logger ?? new Logger(BullMQRecommendationRefreshQueueAdapter.name);
  }

  async enqueueRefresh(profileId: ProfileId): Promise<void> {
    await this.queue.add(
      REFRESH_RECOMMENDATIONS_JOB_NAME,
      { profileId },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    this.logger.log(
      `Enqueued refresh-recommendations job for Profile ${profileId}`,
    );
  }

  async enqueueRefreshForAllProfiles(): Promise<number> {
    if (!this.pool) {
      return 0;
    }
    const res = await this.pool.query<{ id: string }>(
      'SELECT id FROM profiles ORDER BY created_at ASC, id ASC;',
    );
    for (const row of res.rows) {
      await this.enqueueRefresh(asProfileId(row.id));
    }
    return res.rows.length;
  }
}
