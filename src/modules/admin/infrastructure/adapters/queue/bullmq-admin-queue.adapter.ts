import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  AdminQueuePort,
  JobStatusDto,
  JobStatusType,
} from '../../../domain/ports/admin-queue.port';
import { SyncOpportunitiesDto } from '../../../../opportunity/infrastructure/controllers/dtos/sync-opportunities.dto';

@Injectable()
export class BullMQAdminQueueAdapter implements AdminQueuePort {
  private readonly logger: LoggerService;

  constructor(
    private readonly queue: Queue,
    logger?: LoggerService,
  ) {
    this.logger = logger ?? new Logger(BullMQAdminQueueAdapter.name);
  }

  async enqueueSync(body?: SyncOpportunitiesDto): Promise<{ jobId: string }> {
    const jobId = randomUUID();
    await this.queue.add('admin-sync', body ?? {}, {
      jobId,
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    this.logger.log(`Enqueued admin-sync job ${jobId}`);
    return { jobId };
  }

  async enqueueAlertsRun(): Promise<{ jobId: string }> {
    const jobId = randomUUID();
    await this.queue.add(
      'admin-alerts-run',
      {},
      {
        jobId,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    this.logger.log(`Enqueued admin-alerts-run job ${jobId}`);
    return { jobId };
  }

  async enqueueRecommendationsRefresh(): Promise<{ jobId: string }> {
    const jobId = randomUUID();
    await this.queue.add(
      'admin-recommendations-refresh',
      {},
      {
        jobId,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    this.logger.log(`Enqueued admin-recommendations-refresh job ${jobId}`);
    return { jobId };
  }

  async getJobStatus(jobId: string): Promise<JobStatusDto | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = (await job.getState()) as JobStatusType;
    return {
      jobId: job.id ?? jobId,
      name: job.name,
      status: state,
      progress: job.progress,
      failedReason: job.failedReason,
      returnValue: job.returnvalue,
    };
  }
}
