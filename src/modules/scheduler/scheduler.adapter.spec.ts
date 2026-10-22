import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import {
  ScheduleModule,
  SchedulerRegistry,
  CronExpression,
} from '@nestjs/schedule';
import {
  SchedulerAdapter,
  SYNC_OPPORTUNITIES_CRON,
  REVIEW_FOLLOW_UP_CRON,
  SCAN_DEADLINES_CRON,
  SYNC_OPPORTUNITIES_JOB_NAME,
  REVIEW_FOLLOW_UP_JOB_NAME,
  SCAN_DEADLINES_JOB_NAME,
} from './scheduler.adapter';
import { SyncOpportunitiesUseCase } from '../opportunity/application/use-cases/sync-opportunities.use-case';
import { ReviewFollowUpUseCase } from '../alert/application/use-cases/review-follow-up.use-case';
import { ScanDeadlinesUseCase } from '../alert/application/use-cases/scan-deadlines.use-case';
import { ok, err } from '../shared/domain/result';
import { createSourceUnavailableError } from '../shared/domain/errors';

describe('SchedulerAdapter (Driving Adapter per Technical Design §8)', () => {
  let app: INestApplication;
  let schedulerAdapter: SchedulerAdapter;
  let schedulerRegistry: SchedulerRegistry;

  const mockSyncOpportunitiesUseCase = {
    execute: jest.fn(),
  };

  const mockReviewFollowUpUseCase = {
    execute: jest.fn(),
  };

  const mockScanDeadlinesUseCase = {
    execute: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        SchedulerAdapter,
        {
          provide: SyncOpportunitiesUseCase,
          useValue: mockSyncOpportunitiesUseCase,
        },
        {
          provide: ReviewFollowUpUseCase,
          useValue: mockReviewFollowUpUseCase,
        },
        {
          provide: ScanDeadlinesUseCase,
          useValue: mockScanDeadlinesUseCase,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    schedulerAdapter = moduleRef.get<SchedulerAdapter>(SchedulerAdapter);
    schedulerRegistry = moduleRef.get<SchedulerRegistry>(SchedulerRegistry);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Cron Job Registration and Metadata', () => {
    it('should register sync-opportunities, review-follow-up and scan-deadlines cron jobs in SchedulerRegistry', () => {
      const cronJobs = schedulerRegistry.getCronJobs();
      expect(cronJobs.has(SYNC_OPPORTUNITIES_JOB_NAME)).toBe(true);
      expect(cronJobs.has(REVIEW_FOLLOW_UP_JOB_NAME)).toBe(true);
      expect(cronJobs.has(SCAN_DEADLINES_JOB_NAME)).toBe(true);

      const syncJob = schedulerRegistry.getCronJob(SYNC_OPPORTUNITIES_JOB_NAME);
      const reviewJob = schedulerRegistry.getCronJob(REVIEW_FOLLOW_UP_JOB_NAME);
      const scanJob = schedulerRegistry.getCronJob(SCAN_DEADLINES_JOB_NAME);

      expect(syncJob).toBeDefined();
      expect(reviewJob).toBeDefined();
      expect(scanJob).toBeDefined();
    });

    it('should configure sensible cron intervals matching defaults', () => {
      // Default: Every 4 hours for SECOP sync
      expect(SYNC_OPPORTUNITIES_CRON).toBe(CronExpression.EVERY_4_HOURS);
      expect(SYNC_OPPORTUNITIES_CRON).toBe('0 0-23/4 * * *');

      // Default: Daily at 8:00 AM for review follow up
      expect(REVIEW_FOLLOW_UP_CRON).toBe(CronExpression.EVERY_DAY_AT_8AM);
      expect(REVIEW_FOLLOW_UP_CRON).toBe('0 08 * * *');

      // Default: Daily at 7:30 AM for scan deadlines
      expect(SCAN_DEADLINES_CRON).toBe('30 07 * * *');
    });
  });

  describe('handleSyncOpportunities', () => {
    it('should invoke SyncOpportunitiesUseCase.execute and complete successfully', async () => {
      mockSyncOpportunitiesUseCase.execute.mockResolvedValue(
        ok({ created: 10, updated: 3 }),
      );

      await schedulerAdapter.handleSyncOpportunities();

      expect(mockSyncOpportunitiesUseCase.execute).toHaveBeenCalledTimes(1);
      expect(mockSyncOpportunitiesUseCase.execute).toHaveBeenCalledWith({
        maxRecords: 5000,
      });
    });

    it('should handle domain error from SyncOpportunitiesUseCase gracefully without throwing', async () => {
      mockSyncOpportunitiesUseCase.execute.mockResolvedValue(
        err(createSourceUnavailableError('SECOP')),
      );

      await expect(
        schedulerAdapter.handleSyncOpportunities(),
      ).resolves.not.toThrow();

      expect(mockSyncOpportunitiesUseCase.execute).toHaveBeenCalledTimes(1);
    });

    it('should catch unexpected exception from SyncOpportunitiesUseCase gracefully without crashing', async () => {
      mockSyncOpportunitiesUseCase.execute.mockRejectedValue(
        new Error('Unexpected network failure'),
      );

      await expect(
        schedulerAdapter.handleSyncOpportunities(),
      ).resolves.not.toThrow();

      expect(mockSyncOpportunitiesUseCase.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleReviewFollowUp', () => {
    it('should invoke ReviewFollowUpUseCase.execute and complete successfully', async () => {
      mockReviewFollowUpUseCase.execute.mockResolvedValue(
        ok({ alertsSent: 4 }),
      );

      await schedulerAdapter.handleReviewFollowUp();

      expect(mockReviewFollowUpUseCase.execute).toHaveBeenCalledTimes(1);
      expect(mockReviewFollowUpUseCase.execute).toHaveBeenCalledWith();
    });

    it('should handle domain failure result gracefully without throwing', async () => {
      mockReviewFollowUpUseCase.execute.mockResolvedValue({
        ok: false,
        error: new Error('Internal failure'),
      });

      await expect(
        schedulerAdapter.handleReviewFollowUp(),
      ).resolves.not.toThrow();

      expect(mockReviewFollowUpUseCase.execute).toHaveBeenCalledTimes(1);
    });

    it('should catch unexpected exception from ReviewFollowUpUseCase gracefully without crashing', async () => {
      mockReviewFollowUpUseCase.execute.mockRejectedValue(
        new Error('Unexpected SMTP connection reset'),
      );

      await expect(
        schedulerAdapter.handleReviewFollowUp(),
      ).resolves.not.toThrow();

      expect(mockReviewFollowUpUseCase.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleScanDeadlines', () => {
    it('should invoke ScanDeadlinesUseCase.execute and complete successfully', async () => {
      mockScanDeadlinesUseCase.execute.mockResolvedValue(
        ok({ alertsCreated: 3 }),
      );

      await schedulerAdapter.handleScanDeadlines();

      expect(mockScanDeadlinesUseCase.execute).toHaveBeenCalledTimes(1);
    });

    it('should handle domain failure result gracefully without throwing', async () => {
      mockScanDeadlinesUseCase.execute.mockResolvedValue(
        err(new Error('Advisory lock failed')),
      );

      await expect(
        schedulerAdapter.handleScanDeadlines(),
      ).resolves.not.toThrow();

      expect(mockScanDeadlinesUseCase.execute).toHaveBeenCalledTimes(1);
    });

    it('should catch unexpected exception gracefully without crashing', async () => {
      mockScanDeadlinesUseCase.execute.mockRejectedValue(
        new Error('Database disconnected'),
      );

      await expect(
        schedulerAdapter.handleScanDeadlines(),
      ).resolves.not.toThrow();

      expect(mockScanDeadlinesUseCase.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('Triggering via CronJob callback', () => {
    it('should execute SyncOpportunitiesUseCase when the registered cron job tick fires', async () => {
      mockSyncOpportunitiesUseCase.execute.mockResolvedValue(
        ok({ created: 1, updated: 0 }),
      );

      const syncJob = schedulerRegistry.getCronJob(SYNC_OPPORTUNITIES_JOB_NAME);
      // Fire the underlying registered callback directly without waiting hours
      await (syncJob as any).fireOnTick?.();

      expect(mockSyncOpportunitiesUseCase.execute).toHaveBeenCalled();
    });

    it('should execute ReviewFollowUpUseCase when the registered cron job tick fires', async () => {
      mockReviewFollowUpUseCase.execute.mockResolvedValue(
        ok({ alertsSent: 2 }),
      );

      const reviewJob = schedulerRegistry.getCronJob(REVIEW_FOLLOW_UP_JOB_NAME);
      // Fire the underlying registered callback directly without waiting days
      await (reviewJob as any).fireOnTick?.();

      expect(mockReviewFollowUpUseCase.execute).toHaveBeenCalled();
    });

    it('should execute ScanDeadlinesUseCase when the registered cron job tick fires', async () => {
      mockScanDeadlinesUseCase.execute.mockResolvedValue(
        ok({ alertsCreated: 1 }),
      );

      const scanJob = schedulerRegistry.getCronJob(SCAN_DEADLINES_JOB_NAME);
      await (scanJob as any).fireOnTick?.();

      expect(mockScanDeadlinesUseCase.execute).toHaveBeenCalled();
    });
  });

  describe('Pipeline runs recording', () => {
    it('records startRun and completeRun for sync opportunities', async () => {
      const mockPipelineRepo = {
        startRun: jest.fn().mockResolvedValue('run-123'),
        completeRun: jest.fn().mockResolvedValue(undefined),
        failRun: jest.fn().mockResolvedValue(undefined),
        findRecent: jest.fn().mockResolvedValue([]),
      };

      const adapter = new SchedulerAdapter(
        mockSyncOpportunitiesUseCase as any,
        mockReviewFollowUpUseCase as any,
        undefined,
        mockScanDeadlinesUseCase as any,
        mockPipelineRepo,
      );

      mockSyncOpportunitiesUseCase.execute.mockResolvedValueOnce(
        ok({ created: 5, updated: 2 }),
      );

      await adapter.handleSyncOpportunities();

      expect(mockPipelineRepo.startRun).toHaveBeenCalledWith('sync');
      expect(mockPipelineRepo.completeRun).toHaveBeenCalledWith('run-123', {
        created: 5,
        updated: 2,
      });
    });

    it('records failRun when sync opportunities throws', async () => {
      const mockPipelineRepo = {
        startRun: jest.fn().mockResolvedValue('run-456'),
        completeRun: jest.fn().mockResolvedValue(undefined),
        failRun: jest.fn().mockResolvedValue(undefined),
        findRecent: jest.fn().mockResolvedValue([]),
      };

      const adapter = new SchedulerAdapter(
        mockSyncOpportunitiesUseCase as any,
        mockReviewFollowUpUseCase as any,
        undefined,
        mockScanDeadlinesUseCase as any,
        mockPipelineRepo,
      );

      mockSyncOpportunitiesUseCase.execute.mockRejectedValueOnce(
        new Error('Network failure'),
      );

      await adapter.handleSyncOpportunities();

      expect(mockPipelineRepo.startRun).toHaveBeenCalledWith('sync');
      expect(mockPipelineRepo.failRun).toHaveBeenCalledWith(
        'run-456',
        'Network failure',
      );
    });
  });
});
