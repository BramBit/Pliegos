import { z } from 'zod';

const nonEmpty = z.string().min(1);
const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// or postgresql:// connection string');
const httpUrl = z.string().regex(/^https?:\/\/.+/, 'must be an http:// or https:// URL');
const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
});

export type Env = z.infer<typeof envSchema>;

export interface CorsConfig {
  readonly origin: boolean | string | string[];
  readonly credentials: false;
}

export function configureCors(env: { NODE_ENV: string; CORS_ORIGINS?: string }): CorsConfig {
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
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
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

  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.join('.') || '(root)';
      if (issue.path.length === 1 && cleaned[String(issue.path[0])] === undefined) {
        return `${name}: is required (not set or empty)`;
      }
      return `${name}: ${issue.message}`;
    });
    throw new EnvValidationError(problems);
  }
  return result.data;
}
