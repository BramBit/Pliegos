import { EnvValidationError, configureCors, loadEnv } from './env';

const validEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5433/pliegos',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  OLLAMA_BASE_URL: 'http://localhost:11434',
  OLLAMA_EMBED_MODEL: 'nomic-embed-text',
  OLLAMA_CHAT_MODEL: 'llama3.1',
  SYNC_OPPORTUNITIES_CRON: '0 0-23/4 * * *',
  REVIEW_FOLLOW_UP_CRON: '0 08 * * *',
  JWT_SECRET: 'a-very-long-and-secure-jwt-secret-key-32-chars-minimum',
};

describe('loadEnv', () => {
  it('accepts a valid environment and applies defaults', () => {
    const env = loadEnv(validEnv);

    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.JWT_SECRET).toBe(validEnv.JWT_SECRET);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.JWT_REFRESH_TTL).toBe('7d');
    expect(env.SECOP_PAGE_SIZE).toBe(1000);
    expect(env.SECOP_SYNC_MAX_RECORDS).toBe(5000);
    expect(env.SECOP_SYNC_WINDOW_DAYS).toBe(14);
    expect(env.OLLAMA_EMBED_TIMEOUT_MS).toBe(30000);
    expect(env.OLLAMA_CHAT_TIMEOUT_MS).toBe(120000);
    expect(env.ANALYSIS_CONCURRENCY).toBe(2);
    expect(env.SEMANTIC_COSINE_LOW).toBe(0.4);
    expect(env.SEMANTIC_COSINE_HIGH).toBe(0.75);
    expect(env.MIN_RECOMMENDATION_SCORE).toBe(0.45);
    expect(env.TEST_DATABASE_URL).toBeUndefined();
    expect(env.SECOP_APP_TOKEN).toBeUndefined();
  });

  it('coerces numeric values', () => {
    const env = loadEnv({ ...validEnv, PORT: '4000' });

    expect(env.PORT).toBe(4000);
  });

  it('fails when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = validEnv;

    expect(() => loadEnv(withoutDb)).toThrow(EnvValidationError);
    try {
      loadEnv(withoutDb);
    } catch (error) {
      expect((error as EnvValidationError).problems.join('\n')).toContain('DATABASE_URL');
    }
  });

  it('fails when DATABASE_URL is an empty string', () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: '' })).toThrow(EnvValidationError);
  });

  it('fails when PORT is not numeric', () => {
    try {
      loadEnv({ ...validEnv, PORT: 'abc' });
      throw new Error('expected loadEnv to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).problems.join('\n')).toContain('PORT');
    }
  });

  it('reports every problem, one per variable', () => {
    try {
      loadEnv({ ...validEnv, DATABASE_URL: 'mysql://x', REDIS_PORT: 'nope' });
      throw new Error('expected loadEnv to throw');
    } catch (error) {
      const problems = (error as EnvValidationError).problems;
      expect(problems).toHaveLength(2);
    }
  });

  it('fails when JWT_SECRET is missing or less than 32 characters', () => {
    const { JWT_SECRET: _omitted, ...withoutSecret } = validEnv;
    expect(() => loadEnv(withoutSecret)).toThrow(EnvValidationError);

    expect(() => loadEnv({ ...validEnv, JWT_SECRET: 'short-secret' })).toThrow(EnvValidationError);
  });

  it('handles MAX_PROFILES_PER_USER defaults, overrides and validations', () => {
    const envDefault = loadEnv(validEnv);
    expect(envDefault.MAX_PROFILES_PER_USER).toBe(5);

    const envCustom = loadEnv({ ...validEnv, MAX_PROFILES_PER_USER: '8' });
    expect(envCustom.MAX_PROFILES_PER_USER).toBe(8);

    expect(() => loadEnv({ ...validEnv, MAX_PROFILES_PER_USER: '-1' })).toThrow(EnvValidationError);
    expect(() => loadEnv({ ...validEnv, MAX_PROFILES_PER_USER: 'invalid' })).toThrow(EnvValidationError);
  });

  describe('CORS configuration', () => {
    it('defaults CORS_ORIGINS to empty string', () => {
      const env = loadEnv(validEnv);
      expect(env.CORS_ORIGINS).toBe('');
    });

    it('disables CORS in production when CORS_ORIGINS is empty', () => {
      const cors = configureCors({ NODE_ENV: 'production', CORS_ORIGINS: '' });
      expect(cors.origin).toBe(false);
      expect(cors.credentials).toBe(false);
    });

    it('enables all origins in non-production when CORS_ORIGINS is empty', () => {
      const cors = configureCors({ NODE_ENV: 'development', CORS_ORIGINS: '' });
      expect(cors.origin).toBe(true);
      expect(cors.credentials).toBe(false);
    });

    it('parses single and comma-separated origins with credentials false', () => {
      const single = configureCors({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.pliegos.co',
      });
      expect(single.origin).toBe('https://app.pliegos.co');
      expect(single.credentials).toBe(false);

      const multiple = configureCors({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.pliegos.co, https://admin.pliegos.co',
      });
      expect(multiple.origin).toEqual(['https://app.pliegos.co', 'https://admin.pliegos.co']);
      expect(multiple.credentials).toBe(false);
    });
  });
});
