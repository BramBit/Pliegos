import { DiscoveryService } from '@nestjs/core';
import { Pool } from 'pg';
import { WorkerHost } from '@nestjs/bullmq';
import { Queue, Worker } from 'bullmq';
import { GracefulShutdownService } from './graceful-shutdown.service';

describe('GracefulShutdownService', () => {
  let service: GracefulShutdownService;
  let mockPool: { end: jest.Mock };
  let mockWorker: { close: jest.Mock };
  let mockWorkerHost: { worker: typeof mockWorker };
  let mockQueue: { close: jest.Mock; add: jest.Mock };
  let mockDiscoveryService: { getProviders: jest.Mock };
  let executionOrder: string[];

  beforeEach(() => {
    executionOrder = [];

    mockPool = {
      end: jest.fn().mockImplementation(async () => {
        executionOrder.push('pool.end');
      }),
    };

    mockWorker = {
      close: jest.fn().mockImplementation(async () => {
        executionOrder.push('worker.close');
      }),
    };

    mockWorkerHost = Object.create(WorkerHost.prototype);
    Object.defineProperty(mockWorkerHost, 'worker', {
      get: () => mockWorker,
    });

    mockQueue = Object.create(Queue.prototype);
    mockQueue.close = jest.fn().mockImplementation(async () => {
      executionOrder.push('queue.close');
    });
    mockQueue.add = jest.fn();

    mockDiscoveryService = {
      getProviders: jest
        .fn()
        .mockReturnValue([
          { instance: mockWorkerHost },
          { instance: mockQueue },
          { instance: { some: 'other-provider' } },
        ]),
    };

    service = new GracefulShutdownService(
      mockPool as unknown as Pool,
      mockDiscoveryService as unknown as DiscoveryService,
    );
  });

  it('closes pg pool, BullMQ workers, and queues in exact order on SIGTERM', async () => {
    await service.beforeApplicationShutdown('SIGTERM');

    expect(mockPool.end).toHaveBeenCalledTimes(1);
    expect(mockWorker.close).toHaveBeenCalledTimes(1);
    expect(mockQueue.close).toHaveBeenCalledTimes(1);

    expect(executionOrder).toEqual(['pool.end', 'worker.close', 'queue.close']);
  });

  it('is idempotent and runs shutdown sequence only once if called repeatedly', async () => {
    await service.beforeApplicationShutdown('SIGTERM');
    await service.beforeApplicationShutdown('SIGTERM');

    expect(mockPool.end).toHaveBeenCalledTimes(1);
    expect(mockWorker.close).toHaveBeenCalledTimes(1);
    expect(mockQueue.close).toHaveBeenCalledTimes(1);
  });

  it('continues shutdown even if pool.end throws an error', async () => {
    mockPool.end.mockRejectedValueOnce(new Error('Pool close failure'));

    await service.beforeApplicationShutdown('SIGTERM');

    expect(mockPool.end).toHaveBeenCalledTimes(1);
    expect(mockWorker.close).toHaveBeenCalledTimes(1);
    expect(mockQueue.close).toHaveBeenCalledTimes(1);
  });

  it('handles absence of discovery service gracefully', async () => {
    const serviceWithoutDiscovery = new GracefulShutdownService(
      mockPool as unknown as Pool,
    );

    await serviceWithoutDiscovery.beforeApplicationShutdown('SIGTERM');

    expect(mockPool.end).toHaveBeenCalledTimes(1);
  });
});
