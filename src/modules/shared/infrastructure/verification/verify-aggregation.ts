export type CheckStatus = 'PASS' | 'WARN' | 'FAIL';

export interface CheckResult {
  readonly id: number | string;
  readonly name: string;
  readonly status?: CheckStatus;
  readonly passed?: boolean;
  readonly reason?: string;
}

export interface AggregationOutput {
  readonly exitCode: number;
  readonly lines: string[];
  readonly passCount: number;
  readonly warnCount: number;
  readonly failCount: number;
  readonly summary: string;
}

export function aggregateResults(
  results: readonly CheckResult[],
): AggregationOutput {
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  const lines = results.map((r) => {
    let status: CheckStatus;
    if (r.status) {
      status = r.status;
    } else {
      status = r.passed ? 'PASS' : 'FAIL';
    }

    if (status === 'PASS') passCount++;
    else if (status === 'WARN') warnCount++;
    else if (status === 'FAIL') failCount++;

    const detail = r.reason ? ` - ${r.reason}` : '';
    return `[${status}] Check ${r.id}: ${r.name}${detail}`;
  });

  const summary = `PASS ${passCount}, WARN ${warnCount}, FAIL ${failCount}`;
  lines.push(summary);

  return {
    exitCode: failCount > 0 ? 1 : 0,
    lines,
    passCount,
    warnCount,
    failCount,
    summary,
  };
}

export interface EvalThresholds {
  readonly precisionAt10?: number;
  readonly ndcgAt10?: number;
}

export function evaluateCheck8(
  labels: Record<string, Record<string, number>>,
  thresholds: EvalThresholds | null,
  requiredProfiles: readonly string[] = [
    'golden-tech',
    'golden-infra',
    'golden-food',
  ],
): { passed: boolean; reason?: string } {
  if (
    !thresholds ||
    typeof thresholds.precisionAt10 !== 'number' ||
    typeof thresholds.ndcgAt10 !== 'number' ||
    thresholds.precisionAt10 <= 0 ||
    thresholds.ndcgAt10 <= 0
  ) {
    return { passed: false, reason: 'eval thresholds are not set' };
  }

  for (const p of requiredProfiles) {
    const profileLabels = labels[p] || {};
    const totalCount = Object.keys(profileLabels).length;
    if (totalCount < 30) {
      return {
        passed: false,
        reason: `profile ${p} has ${totalCount} labels, expected >= 30`,
      };
    }

    const grade2Count = Object.values(profileLabels).filter(
      (g) => g === 2,
    ).length;
    if (grade2Count < 3) {
      return {
        passed: false,
        reason: `profile ${p} has ${grade2Count} grade 2 labels, expected >= 3`,
      };
    }
  }

  return { passed: true };
}

export function evaluateCheck10(porcelain: string): {
  passed: boolean;
  reason?: string;
} {
  const dirty = porcelain
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => l.substring(3).trim());

  if (dirty.length > 0) {
    return {
      passed: false,
      reason: `uncommitted changes found (${dirty.length} files: ${dirty
        .slice(0, 3)
        .join(', ')}${dirty.length > 3 ? '...' : ''})`,
    };
  }

  return { passed: true };
}
