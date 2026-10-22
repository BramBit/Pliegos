import { Global, Module, Provider } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

const nonEmpty = z.string().min(1);
const postgresUrl = z
  .string()
  .regex(
    /^postgres(ql)?:\/\/.+/,
    'must be a postgres:// or postgresql:// connection string',
  );
const httpUrl = z
  .string()
  .regex(/^https?:\/\/.+/, 'must be an http:// or https:// URL');
const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();

export const INSECURE_JWT_SECRETS = [
  'development-jwt-secret-key-must-be-at-least-32-characters-long',
];

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  PORT: port.default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: postgresUrl,
  TEST_DATABASE_URL: postgresUrl.optional(),

  REDIS_HOST: nonEmpty,
  REDIS_PORT: port,

  OLLAMA_BASE_URL: httpUrl,
  OLLAMA_EMBED_MODEL: nonEmpty,
  OLLAMA_CHAT_MODEL: nonEmpty,
  OLLAMA_EMBED_TIMEOUT_MS: positiveInt.default(30000),
  OLLAMA_CHAT_TIMEOUT_MS: positiveInt.default(120000),

  SYNC_OPPORTUNITIES_CRON: nonEmpty,
  REVIEW_FOLLOW_UP_CRON: nonEmpty,
  SCAN_DEADLINES_CRON: nonEmpty.default('30 07 * * *'),

  SECOP_APP_TOKEN: z.string().optional(),
  SECOP_PAGE_SIZE: positiveInt.default(1000),
  SECOP_SYNC_MAX_RECORDS: positiveInt.default(5000),
  SECOP_SYNC_WINDOW_DAYS: positiveInt.default(14),

  ANALYSIS_CONCURRENCY: positiveInt.default(2),

  SEMANTIC_COSINE_LOW: z.coerce.number().min(-1).max(1).default(0.4),
  SEMANTIC_COSINE_HIGH: z.coerce.number().min(-1).max(1).default(0.75),
  MIN_RECOMMENDATION_SCORE: z.coerce.number().min(0).max(1).default(0.45),

  JWT_SECRET: z.string().min(32, 'must be at least 32 characters long'),
  JWT_ACCESS_TTL: nonEmpty.default('15m'),
  JWT_REFRESH_TTL: nonEmpty.default('7d'),

  MAX_PROFILES_PER_USER: positiveInt.default(5),
  CORS_ORIGINS: z.string().default(''),

  SMTP_HOST: nonEmpty.default('localhost'),
  SMTP_PORT: port.default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: nonEmpty.default('Pliegos <alertas@pliegos.co>'),
  SMTP_SECURE: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .default(false),

  RECOMMEND_DEADLINE_ALERTS: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .default(false),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = 'ENV';

export const envProvider: Provider = {
  provide: ENV,
  useFactory: () => loadEnv(),
};

@Global()
@Module({
  providers: [envProvider],
  exports: [ENV],
})
export class EnvModule {}

export const SYNC_OPPORTUNITIES_CRON =
  process.env.SYNC_OPPORTUNITIES_CRON || '0 0-23/4 * * *';
export const REVIEW_FOLLOW_UP_CRON =
  process.env.REVIEW_FOLLOW_UP_CRON || '0 08 * * *';
export const SCAN_DEADLINES_CRON =
  process.env.SCAN_DEADLINES_CRON || '30 07 * * *';

export function isWorkerRole(source: NodeJS.ProcessEnv = process.env): boolean {
  return (source.ROLE || 'all') !== 'api';
}

export function requireTestDatabaseUrl(): string {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!process.env.TEST_DATABASE_URL && fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const match = /^\s*TEST_DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line);
      if (match) {
        process.env.TEST_DATABASE_URL = match[1];
        break;
      }
    }
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Define it in .env (see .env.example).',
    );
  }
  return url;
}

export interface CorsConfig {
  readonly origin: boolean | string | string[];
  readonly credentials: false;
}

export function configureCors(env: {
  NODE_ENV: string;
  CORS_ORIGINS?: string;
}): CorsConfig {
  const origins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    if (env.NODE_ENV === 'production') {
      return { origin: false, credentials: false };
    }
    return { origin: true, credentials: false };
  }

  return {
    origin: origins.length === 1 ? origins[0] : origins,
    credentials: false,
  };
}

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Parses and validates the environment. An empty string is treated the same as
 * an unset variable, so `DATABASE_URL=` fails instead of silently passing.
 * Throws EnvValidationError listing every problem found.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') {
      cleaned[key] = value;
    }
  }

  const problems: string[] = [];

  if (cleaned.NODE_ENV === 'production' && cleaned.JWT_SECRET) {
    if (INSECURE_JWT_SECRETS.includes(cleaned.JWT_SECRET)) {
      problems.push(
        'JWT_SECRET: cannot use insecure template placeholder in production',
      );
    }
  }

  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const name = issue.path.join('.') || '(root)';
      if (
        issue.path.length === 1 &&
        cleaned[String(issue.path[0])] === undefined
      ) {
        problems.push(`${name}: is required (not set or empty)`);
      } else {
        problems.push(`${name}: ${issue.message}`);
      }
    }
  }

  if (problems.length > 0) {
    throw new EnvValidationError(problems);
  }

  return result.data!;
}
