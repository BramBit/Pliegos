import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { configureCors } from './config/env';

export interface SetupSecurityOptions {
  nodeEnv?: string;
  corsOrigins?: string;
}

/**
 * Baseline HTTP security hardening (P4.3):
 * 1. helmet defaults
 * 2. JSON body limit 100kb
 * 3. Restricted CORS from CORS_ORIGINS with credentials off
 */
export function setupSecurity(app: INestApplication, options?: SetupSecurityOptions): void {
  app.use(helmet());

  const httpAdapter = app.getHttpAdapter() as any;
  if (typeof httpAdapter?.getInstance === 'function') {
    const instance = httpAdapter.getInstance();
    if (typeof instance?.set === 'function') {
      instance.set('trust proxy', true);
    }
  }
  if (typeof httpAdapter?.useBodyParser === 'function') {
    httpAdapter.useBodyParser('json', false, { limit: '100kb' });
    httpAdapter.useBodyParser('urlencoded', false, { extended: true, limit: '100kb' });
  }

  const nodeEnv = options?.nodeEnv ?? 'development';
  const corsOrigins = options?.corsOrigins ?? '';
  app.enableCors(configureCors({ NODE_ENV: nodeEnv, CORS_ORIGINS: corsOrigins }));
}
