export interface CheckResult {
  readonly id: number;
  readonly name: string;
  readonly passed: boolean;
  readonly reason?: string;
}

export interface AggregationOutput {
  readonly exitCode: number;
  readonly lines: string[];
}

export function aggregateResults(
  results: readonly CheckResult[],
): AggregationOutput {
  const lines = results.map((r) => {
    const status = r.passed ? 'PASS' : 'FAIL';
    const detail = r.reason ? ` - ${r.reason}` : '';
    return `[${status}] Check ${r.id}: ${r.name}${detail}`;
  });
  const allPassed = results.every((r) => r.passed);
  return {
    exitCode: allPassed ? 0 : 1,
    lines,
  };
}
