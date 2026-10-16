import { EnvValidationError, loadEnv } from './env';

const validEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5433/pliegos',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  OLLAMA_BASE_URL: 'http://localhost:11434',
  OLLAMA_EMBED_MODEL: 'nomic-embed-text',
  OLLAMA_CHAT_MODEL: 'llama3.1',
  SYNC_OPPORTUNITIES_CRON: '0 0-23/4 * * *',
  REVIEW_FOLLOW_UP_CRON: '0 08 * * *',
};

describe('loadEnv', () => {
  it('accepts a valid environment and applies defaults', () => {
    const env = loadEnv(validEnv);

    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.SECOP_PAGE_SIZE).toBe(1000);
    expect(env.SECOP_SYNC_MAX_RECORDS).toBe(5000);
    expect(env.ANALYSIS_CONCURRENCY).toBe(2);
    expect(env.ANALYSIS_SUMMARIZE).toBe(true);
    expect(env.TEST_DATABASE_URL).toBeUndefined();
    expect(env.SECOP_APP_TOKEN).toBeUndefined();
  });

  it('coerces numeric values and the summarize flag', () => {
    const env = loadEnv({ ...validEnv, PORT: '4000', ANALYSIS_SUMMARIZE: 'false' });

    expect(env.PORT).toBe(4000);
    expect(env.ANALYSIS_SUMMARIZE).toBe(false);
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
});
