import { LoginThrottlerService } from './login-throttler.service';

describe('LoginThrottlerService', () => {
  let throttler: LoginThrottlerService;

  beforeEach(() => {
    throttler = new LoginThrottlerService();
  });

  it('allows 5 failed attempts, then blocks on the 6th', () => {
    const ip = '192.168.1.100';
    const email = 'user@example.com';

    for (let i = 0; i < 4; i++) {
      throttler.recordFailure(ip, email);
      expect(throttler.isBlocked(ip, email)).toBe(false);
    }

    // 5th failure
    throttler.recordFailure(ip, email);
    // After 5 failures within 15 min, it must be blocked
    expect(throttler.isBlocked(ip, email)).toBe(true);
  });

  it('blocks if IP exceeds 5 failed attempts across different emails', () => {
    const ip = '192.168.1.100';

    for (let i = 0; i < 5; i++) {
      throttler.recordFailure(ip, `user${i}@example.com`);
    }

    expect(throttler.isBlocked(ip, 'another-user@example.com')).toBe(true);
  });

  it('blocks if email exceeds 5 failed attempts across different IPs', () => {
    const email = 'victim@example.com';

    for (let i = 0; i < 5; i++) {
      throttler.recordFailure(`10.0.0.${i + 1}`, email);
    }

    expect(throttler.isBlocked('10.0.0.99', email)).toBe(true);
  });

  it('clears failed attempts upon recordSuccess', () => {
    const ip = '192.168.1.100';
    const email = 'user@example.com';

    for (let i = 0; i < 5; i++) {
      throttler.recordFailure(ip, email);
    }
    expect(throttler.isBlocked(ip, email)).toBe(true);

    throttler.recordSuccess(ip, email);
    expect(throttler.isBlocked(ip, email)).toBe(false);
  });
});
