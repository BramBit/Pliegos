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
  PORT: port.default(3000),

  DATABASE_URL: postgresUrl,
  TEST_DATABASE_URL: postgresUrl.optional(),

  REDIS_HOST: nonEmpty,
  REDIS_PORT: port,

  OLLAMA_BASE_URL: httpUrl,
  OLLAMA_EMBED_MODEL: nonEmpty,
  OLLAMA_CHAT_MODEL: nonEmpty,

  SYNC_OPPORTUNITIES_CRON: nonEmpty,
  REVIEW_FOLLOW_UP_CRON: nonEmpty,

  SECOP_APP_TOKEN: z.string().optional(),
  SECOP_PAGE_SIZE: positiveInt.default(1000),
  SECOP_SYNC_MAX_RECORDS: positiveInt.default(5000),

  ANALYSIS_CONCURRENCY: positiveInt.default(2),
  ANALYSIS_SUMMARIZE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

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
