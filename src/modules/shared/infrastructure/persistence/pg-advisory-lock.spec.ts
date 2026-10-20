import { Pool, PoolClient } from 'pg';
import { PgAdvisoryLock } from './pg-advisory-lock';

describe('PgAdvisoryLock', () => {
  let mockClient: {
    query: jest.Mock;
    release: jest.Mock;
  };
  let mockPool: {
    connect: jest.Mock;
  };
  let advisoryLock: PgAdvisoryLock;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
    };
    advisoryLock = new PgAdvisoryLock(mockPool as unknown as Pool);
  });

  it('acquires session advisory lock, executes function, unlocks, and releases client', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return Promise.resolve({ rows: [{ locked: true }] });
      }
      if (sql.includes('pg_advisory_unlock')) {
        return Promise.resolve({ rows: [{ unlocked: true }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const fn = jest.fn().mockResolvedValue('success-result');

    const result = await advisoryLock.withLock('cron:test-job', fn);

    expect(result).toEqual({ executed: true, result: 'success-result' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_try_advisory_lock'),
      ['cron:test-job'],
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      ['cron:test-job'],
    );
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('skips execution when advisory lock is busy without executing the function', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return Promise.resolve({ rows: [{ locked: false }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const fn = jest.fn();

    const result = await advisoryLock.withLock('cron:test-job', fn);

    expect(result).toEqual({ executed: false, reason: 'busy' });
    expect(fn).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('ensures unlock and client release even if the callback function throws', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return Promise.resolve({ rows: [{ locked: true }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const fn = jest.fn().mockRejectedValue(new Error('Job execution crashed'));

    await expect(advisoryLock.withLock('cron:test-job', fn)).rejects.toThrow(
      'Job execution crashed',
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      ['cron:test-job'],
    );
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
