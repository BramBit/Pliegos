import { aggregateResults, CheckResult } from './verify-aggregation';

describe('Verify Aggregation', () => {
  it('returns exitCode 0 when all checks PASS', () => {
    const fakeChecks: CheckResult[] = [
      { id: 1, name: 'tsc --noEmit', passed: true },
      { id: 2, name: 'eslint', passed: true },
      { id: 3, name: 'pnpm test', passed: true },
    ];

    const result = aggregateResults(fakeChecks);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([
      '[PASS] Check 1: tsc --noEmit',
      '[PASS] Check 2: eslint',
      '[PASS] Check 3: pnpm test',
    ]);
  });

  it('returns exitCode 1 when any check FAILS', () => {
    const fakeChecks: CheckResult[] = [
      { id: 1, name: 'tsc --noEmit', passed: true },
      {
        id: 2,
        name: 'eslint',
        passed: false,
        reason: 'syntax error in main.ts',
      },
      { id: 3, name: 'pnpm test', passed: true },
    ];

    const result = aggregateResults(fakeChecks);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      '[PASS] Check 1: tsc --noEmit',
      '[FAIL] Check 2: eslint - syntax error in main.ts',
      '[PASS] Check 3: pnpm test',
    ]);
  });

  it('returns exitCode 1 when multiple checks FAIL', () => {
    const fakeChecks: CheckResult[] = [
      { id: 1, name: 'tsc --noEmit', passed: false, reason: 'compile error' },
      { id: 2, name: 'eslint', passed: false, reason: 'lint error' },
    ];

    const result = aggregateResults(fakeChecks);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      '[FAIL] Check 1: tsc --noEmit - compile error',
      '[FAIL] Check 2: eslint - lint error',
    ]);
  });
});
