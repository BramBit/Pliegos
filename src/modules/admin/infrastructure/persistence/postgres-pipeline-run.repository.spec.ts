import { Pool } from 'pg';
import { PostgresPipelineRunRepository } from './postgres-pipeline-run.repository';

describe('PostgresPipelineRunRepository', () => {
  let repository: PostgresPipelineRunRepository;
  let mockPool: { query: jest.Mock };

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    };
    repository = new PostgresPipelineRunRepository(mockPool as unknown as Pool);
  });

  describe('startRun', () => {
    it('inserts a new running row and returns generated id', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: '11111111-1111-1111-1111-111111111111' }],
      });

      const id = await repository.startRun('sync');

      expect(id).toBe('11111111-1111-1111-1111-111111111111');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pipeline_runs'),
        ['sync'],
      );
    });
  });

  describe('completeRun', () => {
    it('updates status to completed and records stats', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      await repository.completeRun('run-id-1', { created: 10, updated: 5 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE pipeline_runs'),
        ['run-id-1', JSON.stringify({ created: 10, updated: 5 })],
      );
    });
  });

  describe('failRun', () => {
    it('updates status to failed, records error message and stats', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      await repository.failRun('run-id-1', 'Connection lost', { records: 0 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE pipeline_runs'),
        ['run-id-1', 'Connection lost', JSON.stringify({ records: 0 })],
      );
    });
  });

  describe('findRecent', () => {
    it('queries the latest runs ordered by started_at DESC with limit', async () => {
      const now = new Date();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'run-1',
            kind: 'sync',
            started_at: now,
            finished_at: now,
            status: 'completed',
            stats: { created: 1 },
            error: null,
          },
        ],
      });

      const result = await repository.findRecent(20);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('run-1');
      expect(result[0].kind).toBe('sync');
      expect(result[0].status).toBe('completed');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY started_at DESC'),
        [20],
      );
    });
  });
});
