import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from './database.tokens';

export interface LockResult<T> {
  readonly executed: boolean;
  readonly result?: T;
  readonly reason?: 'busy';
}

@Injectable()
export class PgAdvisoryLock {
  private readonly logger = new Logger(PgAdvisoryLock.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Executes fn if and only if the session-level advisory lock on lockKey can be acquired immediately.
   * If the lock is held by another worker/process, logs "skipped" and returns { executed: false, reason: 'busy' }.
   * Ensures the lock is always released and the pool client is returned.
   */
  async withLock<T = void>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<LockResult<T>> {
    return PgAdvisoryLock.withLock(this.pool, name, fn, this.logger);
  }

  static async withLock<T = void>(
    pool: Pool,
    name: string,
    fn: () => Promise<T>,
    logger: Logger = new Logger(PgAdvisoryLock.name),
  ): Promise<LockResult<T>> {
    const client = await pool.connect();
    let acquired = false;
    try {
      const lockRes = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked;',
        [name],
      );
      acquired = Boolean(lockRes.rows[0]?.locked);

      if (!acquired) {
        logger.log(`Lock "${name}" is busy: skipped`);
        return { executed: false, reason: 'busy' };
      }

      const result = await fn();
      return { executed: true, result };
    } finally {
      if (acquired) {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtext($1));', [name]);
        } catch (err) {
          logger.error(`Error unlocking "${name}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      client.release();
    }
  }
}
