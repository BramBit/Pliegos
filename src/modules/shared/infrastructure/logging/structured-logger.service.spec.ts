import { StructuredLoggerService } from './structured-logger.service';
import { requestIdStorage } from '../http/request-id.middleware';

describe('StructuredLoggerService', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('outputs single-line JSON log in production with requestId and redacted content', () => {
    const logger = new StructuredLoggerService({
      nodeEnv: 'production',
      logLevel: 'info',
    });

    requestIdStorage.run('req-test-123', () => {
      logger.log('User test@example.com logged in with password="superSecret"', 'AuthService');
    });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe('info');
    expect(parsed.context).toBe('AuthService');
    expect(parsed.requestId).toBe('req-test-123');
    expect(parsed.message).toContain('[REDACTED_EMAIL]');
    expect(parsed.message).toContain('password="[REDACTED]"');
    expect(parsed.message).not.toContain('test@example.com');
    expect(parsed.message).not.toContain('superSecret');
  });

  it('filters out messages below configured LOG_LEVEL', () => {
    const logger = new StructuredLoggerService({
      nodeEnv: 'production',
      logLevel: 'warn',
    });

    logger.debug('Debug message');
    logger.log('Info message');
    expect(stdoutSpy).not.toHaveBeenCalled();

    logger.warn('Warning message');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);

    logger.error('Error message');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('defaults requestId to system when not inside an HTTP request', () => {
    const logger = new StructuredLoggerService({
      nodeEnv: 'production',
      logLevel: 'info',
    });

    logger.log('Background task running', 'Scheduler');

    const output = stdoutSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.requestId).toBe('system');
    expect(parsed.message).toBe('Background task running');
  });
});
