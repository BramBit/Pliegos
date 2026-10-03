import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AnalysisQueuePort } from '../../../domain/ports/analysis-queue.port';
import { OpportunityId } from '../../../../shared/domain/typed-id';

export const ANALYSIS_QUEUE_NAME = 'opportunity-analysis';
export const ANALYZE_OPPORTUNITY_JOB_NAME = 'analyze-opportunity';

export interface AnalyzeOpportunityJobPayload {
  readonly opportunityId: OpportunityId;
}

export interface IQueueLike {
  add(name: string, data: any, opts?: any): Promise<any>;
}

@Injectable()
export class BullMQAnalysisQueueAdapter implements AnalysisQueuePort {
  private readonly logger: LoggerService;

  constructor(
    private readonly queue: IQueueLike,
    logger?: LoggerService,
  ) {
    this.logger = logger ?? new Logger(BullMQAnalysisQueueAdapter.name);
  }

  /**
   * Enqueues an analysis job for the given opportunity ID into the BullMQ queue.
   */
  async enqueueAnalysis(opportunityId: OpportunityId): Promise<void> {
    const payload: AnalyzeOpportunityJobPayload = { opportunityId };

    await this.queue.add(ANALYZE_OPPORTUNITY_JOB_NAME, payload, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    });

    this.logger.log(`Enqueued analysis job for Opportunity ${opportunityId}`);
  }
}
