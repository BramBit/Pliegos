import { OpportunityId } from '../../../shared/domain/typed-id';

export interface AnalysisQueuePort {
  enqueueAnalysis(opportunityId: OpportunityId): Promise<void>;
}

export const ANALYSIS_QUEUE_PORT = Symbol('ANALYSIS_QUEUE_PORT');
