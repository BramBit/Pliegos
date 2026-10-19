import { SyncOpportunitiesDto } from '../../../opportunity/infrastructure/controllers/dtos/sync-opportunities.dto';

export const ADMIN_QUEUE_PORT = Symbol('ADMIN_QUEUE_PORT');
export const ADMIN_TASKS_QUEUE_NAME = 'admin-tasks';

export type JobStatusType = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';

export interface JobStatusDto {
  readonly jobId: string;
  readonly name: string;
  readonly status: JobStatusType;
  readonly progress?: unknown;
  readonly failedReason?: string;
  readonly returnValue?: unknown;
}

export interface AdminQueuePort {
  enqueueSync(body?: SyncOpportunitiesDto): Promise<{ jobId: string }>;
  enqueueAlertsRun(): Promise<{ jobId: string }>;
  enqueueRecommendationsRefresh(): Promise<{ jobId: string }>;
  getJobStatus(jobId: string): Promise<JobStatusDto | null>;
}
