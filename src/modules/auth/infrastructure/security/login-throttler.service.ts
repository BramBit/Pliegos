import { Injectable } from '@nestjs/common';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_FAILED_ATTEMPTS = 5;

@Injectable()
export class LoginThrottlerService {
  private readonly attemptsByEmail = new Map<string, number[]>();
  private readonly attemptsByIp = new Map<string, number[]>();

  isBlocked(ip: string, email: string): boolean {
    const now = Date.now();
    const emailAttempts = this.cleanAndGetAttempts(this.attemptsByEmail, email.toLowerCase().trim(), now);
    const ipAttempts = this.cleanAndGetAttempts(this.attemptsByIp, ip.trim(), now);

    return emailAttempts.length >= MAX_FAILED_ATTEMPTS || ipAttempts.length >= MAX_FAILED_ATTEMPTS;
  }

  recordFailure(ip: string, email: string): void {
    const now = Date.now();
    const cleanEmail = email.toLowerCase().trim();
    const cleanIp = ip.trim();

    const emailAttempts = this.cleanAndGetAttempts(this.attemptsByEmail, cleanEmail, now);
    emailAttempts.push(now);
    this.attemptsByEmail.set(cleanEmail, emailAttempts);

    const ipAttempts = this.cleanAndGetAttempts(this.attemptsByIp, cleanIp, now);
    ipAttempts.push(now);
    this.attemptsByIp.set(cleanIp, ipAttempts);
  }

  recordSuccess(ip: string, email: string): void {
    this.attemptsByEmail.delete(email.toLowerCase().trim());
    this.attemptsByIp.delete(ip.trim());
  }

  reset(): void {
    this.attemptsByEmail.clear();
    this.attemptsByIp.clear();
  }

  private cleanAndGetAttempts(
    map: Map<string, number[]>,
    key: string,
    now: number,
  ): number[] {
    const raw = map.get(key) ?? [];
    const threshold = now - LOGIN_WINDOW_MS;
    const filtered = raw.filter((timestamp) => timestamp > threshold);
    if (filtered.length !== raw.length) {
      if (filtered.length === 0) {
        map.delete(key);
      } else {
        map.set(key, filtered);
      }
    }
    return filtered;
  }
}
