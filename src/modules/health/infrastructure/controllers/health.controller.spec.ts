import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { HealthController } from './health.controller';

jest.mock('ioredis');

describe('HealthController', () => {
  let controller: HealthController;
  let mockPool: { query: jest.Mock };
  let mockConfig: { get: jest.Mock };
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    mockPool = {
      query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    };
    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'REDIS_HOST') return 'localhost';
        if (key === 'REDIS_PORT') return 6379;
        if (key === 'OLLAMA_BASE_URL') return 'http://localhost:11434';
        return undefined;
      }),
    };

    (Redis as unknown as jest.Mock).mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      ping: jest.fn().mockResolvedValue('PONG'),
      disconnect: jest.fn(),
    }));

    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    controller = new HealthController(
      mockPool as unknown as Pool,
      mockConfig as unknown as ConfigService,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('live', () => {
    it('returns status ok and uptime number', () => {
      const result = controller.live();
      expect(result.status).toBe('ok');
      expect(typeof result.uptime).toBe('number');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('ready', () => {
    it('returns 200 ok when postgres, redis, and ollama are up', async () => {
      const result = await controller.ready();

      expect(result).toEqual({
        status: 'ok',
        checks: {
          postgres: 'up',
          redis: 'up',
          ollama: 'up',
        },
      });
    });

    it('returns 200 degraded when postgres and redis are up but ollama is down', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await controller.ready();

      expect(result).toEqual({
        status: 'degraded',
        checks: {
          postgres: 'up',
          redis: 'up',
          ollama: 'down',
        },
      });
    });

    it('throws 503 HttpException when postgres is down', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB connection failed'));

      await expect(controller.ready()).rejects.toThrow(HttpException);

      try {
        await controller.ready();
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(503);
        expect(httpErr.getResponse()).toEqual({
          status: 'unhealthy',
          checks: {
            postgres: 'down',
            redis: 'up',
            ollama: 'up',
          },
        });
      }
    });

    it('throws 503 HttpException when redis is down', async () => {
      (Redis as unknown as jest.Mock).mockImplementationOnce(() => ({
        connect: jest.fn().mockRejectedValue(new Error('Redis connection refused')),
        disconnect: jest.fn(),
      }));

      await expect(controller.ready()).rejects.toThrow(HttpException);

      try {
        await controller.ready();
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(503);
        expect(httpErr.getResponse()).toEqual({
          status: 'unhealthy',
          checks: {
            postgres: 'up',
            redis: 'down',
            ollama: 'up',
          },
        });
      }
    });
  });
});
