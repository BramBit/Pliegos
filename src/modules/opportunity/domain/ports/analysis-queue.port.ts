import { OpportunityId } from '../../../shared/domain/typed-id';

export interface EnqueueAnalysisOptions {
  readonly summarize?: boolean;
}

export interface AnalysisQueuePort {
  enqueueAnalysis(
    opportunityId: OpportunityId,
    options?: EnqueueAnalysisOptions,
  ): Promise<void>;
}

export const ANALYSIS_QUEUE_PORT = Symbol('ANALYSIS_QUEUE_PORT');
