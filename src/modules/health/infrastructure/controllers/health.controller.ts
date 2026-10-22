import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DATABASE_POOL } from '../../../shared/infrastructure/persistence/database.module';
import { Public } from '../../../auth/infrastructure/security/public.decorator';

export interface HealthCheckResult {
  readonly status: 'ok' | 'degraded' | 'unhealthy';
  readonly checks: {
    readonly postgres: 'up' | 'down';
    readonly redis: 'up' | 'down';
    readonly ollama: 'up' | 'down';
  };
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE_POOL)
    private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('live')
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Indica si el proceso de la aplicación está activo y respondiendo.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Servicio activo' })
  live(): { status: 'ok'; uptime: number } {
    return {
      status: 'ok',
      uptime: process.uptime(),
    };
  }

  @Public()
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Verifica la conectividad con PostgreSQL, Redis y Ollama. Falla con 503 si PostgreSQL o Redis no responden. Retorna 200 con status degraded si Ollama no responde.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Servicio listo o degradado',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Dependencia crítica caída',
  })
  async ready(): Promise<HealthCheckResult> {
    const checks: {
      postgres: 'up' | 'down';
      redis: 'up' | 'down';
      ollama: 'up' | 'down';
    } = {
      postgres: 'down',
      redis: 'down',
      ollama: 'down',
    };

    let postgresOk = false;
    try {
      await this.pool.query('SELECT 1;');
      checks.postgres = 'up';
      postgresOk = true;
    } catch {
      checks.postgres = 'down';
    }

    let redisOk = false;
    let redisClient: Redis | null = null;
    try {
      const redisHost = this.config.get<string>('REDIS_HOST') || 'localhost';
      const redisPort = Number(this.config.get('REDIS_PORT')) || 6379;
      redisClient = new Redis({
        host: redisHost,
        port: redisPort,
        connectTimeout: 2000,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      await redisClient.connect();
      const pong = await redisClient.ping();
      if (pong === 'PONG') {
        checks.redis = 'up';
        redisOk = true;
      }
    } catch {
      checks.redis = 'down';
    } finally {
      if (redisClient) {
        try {
          redisClient.disconnect();
        } catch {
          // ignore
        }
      }
    }

    let ollamaOk = false;
    try {
      const ollamaUrl =
        this.config.get<string>('OLLAMA_BASE_URL') || 'http://localhost:11434';
      const resp = await fetch(`${ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        checks.ollama = 'up';
        ollamaOk = true;
      }
    } catch {
      checks.ollama = 'down';
    }

    if (!postgresOk || !redisOk) {
      throw new HttpException(
        {
          status: 'unhealthy',
          checks,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const status: 'ok' | 'degraded' = ollamaOk ? 'ok' : 'degraded';
    return {
      status,
      checks,
    };
  }
}
