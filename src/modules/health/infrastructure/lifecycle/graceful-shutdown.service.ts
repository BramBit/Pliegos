import {
  Injectable,
  Logger,
  BeforeApplicationShutdown,
  Inject,
  Optional,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Pool } from 'pg';
import { WorkerHost } from '@nestjs/bullmq';
import { Queue, Worker } from 'bullmq';
import { DATABASE_POOL } from '../../../shared/infrastructure/persistence/database.module';

@Injectable()
export class GracefulShutdownService implements BeforeApplicationShutdown {
  private readonly logger = new Logger('Shutdown');
  private isShuttingDown = false;

  constructor(
    @Inject(DATABASE_POOL)
    private readonly pool: Pool,
    @Optional()
    private readonly discoveryService?: DiscoveryService,
  ) {}

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.logger.log(
      `Received ${signal || 'SIGTERM'}, shutting down gracefully...`,
    );

    // 1. Close PostgreSQL pool
    this.logger.log('Closing PostgreSQL pool...');
    try {
      const p = this.pool as any;
      if (p && !p.ending && !p.ended) {
        await this.pool.end();
      }
      this.logger.log('PostgreSQL pool closed.');
    } catch (error) {
      this.logger.error(
        `Error closing PostgreSQL pool: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 2. Close BullMQ workers
    this.logger.log('Closing BullMQ workers...');
    const workers = this.findWorkers();
    for (const worker of workers) {
      try {
        await worker.close();
      } catch (error) {
        this.logger.error(
          `Error closing BullMQ worker: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.logger.log(`BullMQ workers closed (${workers.length} worker(s)).`);

    // 3. Close BullMQ queues
    this.logger.log('Closing BullMQ queues...');
    const queues = this.findQueues();
    for (const queue of queues) {
      try {
        await queue.close();
      } catch (error) {
        this.logger.error(
          `Error closing BullMQ queue: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.logger.log(`BullMQ queues closed (${queues.length} queue(s)).`);

    this.logger.log('Graceful shutdown completed.');
  }

  private findWorkers(): Worker[] {
    const workers = new Set<Worker>();
    if (!this.discoveryService) return [];

    try {
      const providers = this.discoveryService.getProviders();
      for (const wrapper of providers) {
        const instance = wrapper?.instance;
        if (!instance) continue;

        if (instance instanceof WorkerHost) {
          try {
            const w = instance.worker;
            if (w && typeof w.close === 'function') {
              workers.add(w);
            }
          } catch {
            // worker getter might throw if not yet initialized
          }
        } else if (
          instance instanceof Worker ||
          (instance.constructor?.name === 'Worker' &&
            typeof instance.close === 'function')
        ) {
          workers.add(instance as Worker);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to discover BullMQ workers: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return Array.from(workers);
  }

  private findQueues(): Queue[] {
    const queues = new Set<Queue>();
    if (!this.discoveryService) return [];

    try {
      const providers = this.discoveryService.getProviders();
      for (const wrapper of providers) {
        const instance = wrapper?.instance;
        if (!instance) continue;

        if (
          instance instanceof Queue ||
          (instance.constructor?.name === 'Queue' &&
            typeof instance.close === 'function' &&
            typeof instance.add === 'function')
        ) {
          queues.add(instance as Queue);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to discover BullMQ queues: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return Array.from(queues);
  }
}
