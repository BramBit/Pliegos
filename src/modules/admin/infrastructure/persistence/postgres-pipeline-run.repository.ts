import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../../../shared/infrastructure/persistence/database.module';
import {
  PipelineRun,
  PipelineRunKind,
  PipelineRunRepositoryPort,
} from '../../domain/ports/pipeline-run-repository.port';

@Injectable()
export class PostgresPipelineRunRepository implements PipelineRunRepositoryPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async startRun(kind: PipelineRunKind): Promise<string> {
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO pipeline_runs (kind, started_at, status)
       VALUES ($1, NOW(), 'running')
       RETURNING id;`,
      [kind],
    );
    return res.rows[0].id;
  }

  async completeRun(id: string, stats?: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline_runs
       SET finished_at = NOW(),
           status = 'completed',
           stats = $2
       WHERE id = $1;`,
      [id, stats ? JSON.stringify(stats) : null],
    );
  }

  async failRun(id: string, error: string, stats?: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline_runs
       SET finished_at = NOW(),
           status = 'failed',
           error = $2,
           stats = $3
       WHERE id = $1;`,
      [id, error, stats ? JSON.stringify(stats) : null],
    );
  }

  async findRecent(limit = 20): Promise<PipelineRun[]> {
    const res = await this.pool.query<{
      id: string;
      kind: PipelineRunKind;
      started_at: Date;
      finished_at: Date | null;
      status: 'running' | 'completed' | 'failed';
      stats: Record<string, unknown> | null;
      error: string | null;
    }>(
      `SELECT id, kind, started_at, finished_at, status, stats, error
       FROM pipeline_runs
       ORDER BY started_at DESC
       LIMIT $1;`,
      [limit],
    );

    return res.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status,
      stats: row.stats,
      error: row.error,
    }));
  }
}
