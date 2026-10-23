import {
  aggregateResults,
  CheckResult,
  evaluateCheck8,
  evaluateCheck10,
} from './verify-aggregation';

describe('Verify Aggregation (P8.4)', () => {
  it('returns exitCode 0 when all checks PASS', () => {
    const fakeChecks: CheckResult[] = [
      { id: 1, name: 'tsc --noEmit', status: 'PASS' },
      { id: 2, name: 'eslint', status: 'PASS' },
      { id: 3, name: 'pnpm test', status: 'PASS' },
    ];

    const result = aggregateResults(fakeChecks);
    expect(result.exitCode).toBe(0);
    expect(result.passCount).toBe(3);
    expect(result.warnCount).toBe(0);
    expect(result.failCount).toBe(0);
    expect(result.lines).toEqual([
      '[PASS] Check 1: tsc --noEmit',
      '[PASS] Check 2: eslint',
      '[PASS] Check 3: pnpm test',
      'PASS 3, WARN 0, FAIL 0',
    ]);
  });

  it('aggregation with only WARN gives exit code 0', () => {
    const fakeChecks: CheckResult[] = [
      { id: 1, name: 'tsc --noEmit', status: 'PASS' },
      {
        id: '7b',
        name: 'source data quality',
        status: 'WARN',
        reason: 'known amount 88.6% < 90%',
      },
      { id: 8, name: 'eval gate', status: 'PASS' },
    ];

    const result = aggregateResults(fakeChecks);
    expect(result.exitCode).toBe(0);
    expect(result.passCount).toBe(2);
    expect(result.warnCount).toBe(1);
    expect(result.failCount).toBe(0);
    expect(result.lines).toContain(
      '[WARN] Check 7b: source data quality - known amount 88.6% < 90%',
    );
    expect(result.lines[result.lines.length - 1]).toBe(
      'PASS 2, WARN 1, FAIL 0',
    );
  });

  it('aggregation with one FAIL gives exit code 1', () => {
    const fakeChecks: CheckResult[] = [
      { id: 1, name: 'tsc --noEmit', status: 'PASS' },
      {
        id: 2,
        name: 'eslint',
        status: 'FAIL',
        reason: 'syntax error in main.ts',
      },
      {
        id: '7b',
        name: 'source data quality',
        status: 'WARN',
        reason: 'known amount 88.6% < 90%',
      },
    ];

    const result = aggregateResults(fakeChecks);
    expect(result.exitCode).toBe(1);
    expect(result.passCount).toBe(1);
    expect(result.warnCount).toBe(1);
    expect(result.failCount).toBe(1);
    expect(result.lines[result.lines.length - 1]).toBe(
      'PASS 1, WARN 1, FAIL 1',
    );
  });

  describe('evaluateCheck8', () => {
    const buildValidProfileLabels = () => {
      const labels: Record<string, number> = {};
      // 3 grade 2 labels
      labels['id-g2-1'] = 2;
      labels['id-g2-2'] = 2;
      labels['id-g2-3'] = 2;
      // 27 grade 0 labels to reach 30
      for (let i = 0; i < 27; i++) {
        labels[`id-g0-${i}`] = 0;
      }
      return labels;
    };

    it('fails with "eval thresholds are not set" when thresholds are zero or missing', () => {
      const labels = {
        'golden-tech': buildValidProfileLabels(),
        'golden-infra': buildValidProfileLabels(),
        'golden-food': buildValidProfileLabels(),
      };

      const resultZero = evaluateCheck8(labels, {
        precisionAt10: 0,
        ndcgAt10: 0,
      });
      expect(resultZero.passed).toBe(false);
      expect(resultZero.reason).toBe('eval thresholds are not set');

      const resultNull = evaluateCheck8(labels, null);
      expect(resultNull.passed).toBe(false);
      expect(resultNull.reason).toBe('eval thresholds are not set');
    });

    it('fails when a profile has no grade 2 labels', () => {
      const labelsWithoutGrade2: Record<string, number> = {};
      for (let i = 0; i < 35; i++) {
        labelsWithoutGrade2[`id-${i}`] = 0;
      }

      const labels = {
        'golden-tech': buildValidProfileLabels(),
        'golden-infra': buildValidProfileLabels(),
        'golden-food': labelsWithoutGrade2,
      };

      const result = evaluateCheck8(labels, {
        precisionAt10: 0.8,
        ndcgAt10: 0.85,
      });
      expect(result.passed).toBe(false);
      expect(result.reason).toBe(
        'profile golden-food has 0 grade 2 labels, expected >= 3',
      );
    });

    it('fails when a profile has fewer than 30 labels', () => {
      const shortLabels: Record<string, number> = {
        'id-1': 2,
        'id-2': 2,
        'id-3': 2,
      };

      const labels = {
        'golden-tech': shortLabels,
        'golden-infra': buildValidProfileLabels(),
        'golden-food': buildValidProfileLabels(),
      };

      const result = evaluateCheck8(labels, {
        precisionAt10: 0.8,
        ndcgAt10: 0.85,
      });
      expect(result.passed).toBe(false);
      expect(result.reason).toBe(
        'profile golden-tech has 3 labels, expected >= 30',
      );
    });

    it('passes when all profiles have >= 30 labels, >= 3 grade 2 labels, and thresholds > 0', () => {
      const labels = {
        'golden-tech': buildValidProfileLabels(),
        'golden-infra': buildValidProfileLabels(),
        'golden-food': buildValidProfileLabels(),
      };

      const result = evaluateCheck8(labels, {
        precisionAt10: 0.8,
        ndcgAt10: 0.85,
      });
      expect(result.passed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('evaluateCheck10', () => {
    it('passes when git status --porcelain is empty', () => {
      expect(evaluateCheck10('')).toEqual({ passed: true });
      expect(evaluateCheck10('\n')).toEqual({ passed: true });
    });

    it('fails on any uncommitted or untracked file, with no special cases', () => {
      const result = evaluateCheck10(
        ' M README.md\n?? docs/handoff-2026-10-16.md\n M eval/LABELING.md\n',
      );
      expect(result.passed).toBe(false);
      expect(result.reason).toBe(
        'uncommitted changes found (3 files: README.md, docs/handoff-2026-10-16.md, eval/LABELING.md)',
      );
    });

    it('truncates the file list after three entries', () => {
      const result = evaluateCheck10(' M a.ts\n M b.ts\n M c.ts\n?? d.ts\n');
      expect(result.passed).toBe(false);
      expect(result.reason).toBe(
        'uncommitted changes found (4 files: a.ts, b.ts, c.ts...)',
      );
    });
  });
});
