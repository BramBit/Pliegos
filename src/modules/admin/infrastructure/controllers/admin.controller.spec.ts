import { AdminController } from './admin.controller';
import { AdminQueuePort } from '../../domain/ports/admin-queue.port';
import { AiMetricsService } from '../../../shared/infrastructure/ai/ai-metrics.service';
import { PipelineRunRepositoryPort } from '../../domain/ports/pipeline-run-repository.port';

describe('AdminController', () => {
  let controller: AdminController;
  let mockAdminQueue: jest.Mocked<AdminQueuePort>;
  let aiMetricsService: AiMetricsService;
  let mockPipelineRepo: jest.Mocked<PipelineRunRepositoryPort>;

  beforeEach(() => {
    mockAdminQueue = {
      enqueueSync: jest.fn(),
      enqueueAlertsRun: jest.fn(),
      enqueueRecommendationsRefresh: jest.fn(),
      getJobStatus: jest.fn(),
    };

    aiMetricsService = new AiMetricsService();

    mockPipelineRepo = {
      startRun: jest.fn(),
      completeRun: jest.fn(),
      failRun: jest.fn(),
      findRecent: jest.fn(),
    };

    controller = new AdminController(
      mockAdminQueue,
      aiMetricsService,
      mockPipelineRepo,
    );
  });

  describe('GET /admin/metrics', () => {
    it('returns structured AI metrics with calls, failures, p50 and p95', async () => {
      aiMetricsService.record({
        feature: 'embedding',
        model: 'nomic-embed-text',
        latencyMs: 15,
        inputChars: 50,
        success: true,
      });

      const metrics = await controller.getMetrics();

      expect(metrics.overall.calls).toBe(1);
      expect(metrics.overall.failures).toBe(0);
      expect(metrics.overall.p50).toBe(15);
      expect(metrics.overall.p95).toBe(15);
      expect(metrics.byFeature['embedding']).toBeDefined();
    });
  });

  describe('GET /admin/pipeline', () => {
    it('queries and returns the last 20 pipeline runs', async () => {
      const now = new Date();
      mockPipelineRepo.findRecent.mockResolvedValueOnce([
        {
          id: 'test-run-1',
          kind: 'sync',
          startedAt: now,
          finishedAt: now,
          status: 'completed',
          stats: { created: 10, updated: 2 },
          error: null,
        },
      ]);

      const runs = await controller.getPipeline();

      expect(mockPipelineRepo.findRecent).toHaveBeenCalledWith(20);
      expect(runs).toHaveLength(1);
      expect(runs[0].kind).toBe('sync');
      expect(runs[0].status).toBe('completed');
    });
  });
});
