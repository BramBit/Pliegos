import {
  SchedulerAdapter,
  SYNC_OPPORTUNITIES_JOB_NAME,
} from './scheduler.adapter';
import { SyncOpportunitiesUseCase } from '../opportunity/application/use-cases/sync-opportunities.use-case';
import { ReviewFollowUpUseCase } from '../alert/application/use-cases/review-follow-up.use-case';
import { PgAdvisoryLock } from '../shared/infrastructure/persistence/pg-advisory-lock';
import { ok } from '../shared/domain/result';

describe('Scheduler Concurrency (Two Scheduler Instances)', () => {
  it('two scheduler instances triggered at the same instant execute the job only once', async () => {
    let lockHolder: string | null = null;

    // Simulate PostgreSQL advisory lock with mutual exclusion
    const createMockAdvisoryLock = (instanceId: string) => {
      return {
        withLock: jest.fn(async (name: string, fn: () => Promise<void>) => {
          if (lockHolder !== null) {
            return { executed: false, reason: 'busy' };
          }
          lockHolder = instanceId;
          try {
            // Simulate work taking some time
            await new Promise((resolve) => setTimeout(resolve, 20));
            const result = await fn();
            return { executed: true, result };
          } finally {
            lockHolder = null;
          }
        }),
      } as unknown as PgAdvisoryLock;
    };

    const mockSyncUseCase = {
      execute: jest.fn().mockResolvedValue(ok({ created: 3, updated: 1 })),
    };
    const mockReviewUseCase = {
      execute: jest.fn(),
    };

    const schedulerInstance1 = new SchedulerAdapter(
      mockSyncUseCase as unknown as SyncOpportunitiesUseCase,
      mockReviewUseCase as unknown as ReviewFollowUpUseCase,
      undefined,
      undefined,
      undefined,
      createMockAdvisoryLock('instance-1'),
    );

    const schedulerInstance2 = new SchedulerAdapter(
      mockSyncUseCase as unknown as SyncOpportunitiesUseCase,
      mockReviewUseCase as unknown as ReviewFollowUpUseCase,
      undefined,
      undefined,
      undefined,
      createMockAdvisoryLock('instance-2'),
    );

    // Trigger both instances concurrently at the exact same instant
    await Promise.all([
      schedulerInstance1.handleSyncOpportunities(),
      schedulerInstance2.handleSyncOpportunities(),
    ]);

    // Expect the underlying use case to have been executed exactly once
    expect(mockSyncUseCase.execute).toHaveBeenCalledTimes(1);
  });
});
