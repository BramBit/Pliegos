export type PipelineRunKind =
  'sync' | 'analysis' | 'refresh' | 'deadlines' | 'alerts';
export type PipelineRunStatus = 'running' | 'completed' | 'failed';

export interface PipelineRun {
  readonly id: string;
  readonly kind: PipelineRunKind;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly status: PipelineRunStatus;
  readonly stats: Record<string, unknown> | null;
  readonly error: string | null;
}

export interface PipelineRunRepositoryPort {
  startRun(kind: PipelineRunKind): Promise<string>;
  completeRun(id: string, stats?: Record<string, unknown>): Promise<void>;
  failRun(
    id: string,
    error: string,
    stats?: Record<string, unknown>,
  ): Promise<void>;
  findRecent(limit?: number): Promise<PipelineRun[]>;
}

export const PIPELINE_RUN_REPOSITORY_PORT = Symbol(
  'PIPELINE_RUN_REPOSITORY_PORT',
);
