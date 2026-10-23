import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { Pool } from 'pg';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { setupSwaggerAndScalar } from '../src/setup-swagger';
import { runMigrations } from '../src/modules/shared/infrastructure/persistence/migrator';
import {
  aggregateResults,
  CheckResult,
  evaluateCheck8,
  evaluateCheck10,
  EvalThresholds,
} from '../src/modules/shared/infrastructure/verification/verify-aggregation';

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

async function runCheck1(): Promise<CheckResult> {
  const name = 'tsc --noEmit';
  try {
    execSync('pnpm exec tsc --noEmit', { stdio: 'pipe' });
    return { id: 1, name, status: 'PASS', passed: true };
  } catch (err: any) {
    return {
      id: 1,
      name,
      status: 'FAIL',
      passed: false,
      reason: err.stderr?.toString()?.trim() || 'TypeScript type check failed',
    };
  }
}

async function runCheck2(): Promise<CheckResult> {
  const name = 'eslint (errors only)';
  try {
    execSync('pnpm exec eslint --quiet .', { stdio: 'pipe' });
    return { id: 2, name, status: 'PASS', passed: true };
  } catch (err: any) {
    return {
      id: 2,
      name,
      status: 'FAIL',
      passed: false,
      reason: err.stdout?.toString()?.trim() || 'ESLint errors found',
    };
  }
}

async function runCheck3(): Promise<CheckResult> {
  const name = 'all tests (pnpm test)';
  try {
    execSync('pnpm test', { stdio: 'pipe' });
    return { id: 3, name, status: 'PASS', passed: true };
  } catch {
    return {
      id: 3,
      name,
      status: 'FAIL',
      passed: false,
      reason: 'one or more test suites failed',
    };
  }
}

async function runCheck4(): Promise<CheckResult> {
  const name = 'check:arch reports no violation outside the baseline';
  try {
    execSync('pnpm check:arch', { stdio: 'pipe' });
    return { id: 4, name, status: 'PASS', passed: true };
  } catch {
    return {
      id: 4,
      name,
      status: 'FAIL',
      passed: false,
      reason: 'architecture boundary violations outside baseline found',
    };
  }
}

async function runCheck5(): Promise<CheckResult> {
  const name = 'scratch migrations (pliegos_verify)';
  const dbUrl =
    process.env.DATABASE_URL ||
    process.env.TEST_DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5433/pliegos';
  const adminUrl = dbUrl.replace(/\/[^/?]+(\?.*)?$/, '/postgres$1');
  const verifyDbUrl = dbUrl.replace(/\/[^/?]+(\?.*)?$/, '/pliegos_verify$1');
  const migrationsDir = path.resolve(process.cwd(), 'migrations');

  const adminPool = new Pool({ connectionString: adminUrl });
  try {
    await adminPool.query(
      'DROP DATABASE IF EXISTS pliegos_verify WITH (FORCE);',
    );
    await adminPool.query('CREATE DATABASE pliegos_verify;');

    const verifyPool = new Pool({ connectionString: verifyDbUrl });
    try {
      const run1 = await runMigrations(verifyPool, migrationsDir);
      const run2 = await runMigrations(verifyPool, migrationsDir);

      if (run1.applied.length === 0) {
        return {
          id: 5,
          name,
          status: 'FAIL',
          passed: false,
          reason: 'first run applied 0 migrations',
        };
      }
      if (run2.applied.length !== 0) {
        return {
          id: 5,
          name,
          status: 'FAIL',
          passed: false,
          reason: `second run applied ${run2.applied.length} migrations (expected 0)`,
        };
      }
      return { id: 5, name, status: 'PASS', passed: true };
    } finally {
      await verifyPool.end();
    }
  } catch (err: any) {
    return {
      id: 5,
      name,
      status: 'FAIL',
      passed: false,
      reason: err.message || 'migration test error',
    };
  } finally {
    try {
      await adminPool.query(
        'DROP DATABASE IF EXISTS pliegos_verify WITH (FORCE);',
      );
    } catch {
      // ignore
    }
    await adminPool.end();
  }
}

async function runCheck6(): Promise<CheckResult> {
  const name = 'docs/openapi.json is up to date';
  try {
    const app = await NestFactory.create(AppModule, { logger: false });
    const doc = setupSwaggerAndScalar(app);
    await app.close();

    const tmpPath = path.resolve('/tmp/openapi-verify.json');
    const regenerated = JSON.stringify(doc, null, 2) + '\n';
    fs.writeFileSync(tmpPath, regenerated, 'utf8');

    const openApiPath = path.resolve(process.cwd(), 'docs/openapi.json');
    if (!fs.existsSync(openApiPath)) {
      return {
        id: 6,
        name,
        status: 'FAIL',
        passed: false,
        reason: 'docs/openapi.json does not exist',
      };
    }

    const current = fs.readFileSync(openApiPath, 'utf8');
    if (current !== regenerated) {
      return {
        id: 6,
        name,
        status: 'FAIL',
        passed: false,
        reason: 'docs/openapi.json differs from current API definition',
      };
    }
    return { id: 6, name, status: 'PASS', passed: true };
  } catch (err: any) {
    return {
      id: 6,
      name,
      status: 'FAIL',
      passed: false,
      reason: err.message || 'failed to regenerate openapi spec',
    };
  }
}

interface VerifyConfig {
  must: {
    minRecommendableRows: number;
    minDescriptionPct: number;
    minEmbeddingPct: number;
  };
  watch: {
    knownAmountPct: { warn: number; fail: number };
    knownDepartmentPct: { warn: number; fail: number };
    unknownStatusPct: { warn: number; fail: number };
  };
}

interface CoverageMetrics {
  totalOpportunities: number;
  unknownCount: number;
  unknownPct: number;
  recTotal: number;
  descPct: number;
  embPct: number;
  deptPct: number;
  amtPct: number;
}

let cachedMetrics: CoverageMetrics | null = null;
let cachedConfig: VerifyConfig | null = null;

function loadVerifyConfig(): VerifyConfig | null {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'verify.config.json');
  if (!fs.existsSync(configPath)) return null;
  cachedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return cachedConfig;
}

async function fetchCoverageMetrics(): Promise<CoverageMetrics> {
  if (cachedMetrics) return cachedMetrics;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set in environment');

  const pool = new Pool({ connectionString: dbUrl });
  try {
    const totalsRes = await pool.query(`
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN status = 'Unknown' THEN 1 END)::int as unknown_count
      FROM opportunities;
    `);
    const totalOpportunities = totalsRes.rows[0].total;
    const unknownCount = totalsRes.rows[0].unknown_count;
    const unknownPct =
      totalOpportunities > 0 ? (unknownCount / totalOpportunities) * 100 : 0;

    const recRes = await pool.query(`
      SELECT 
        COUNT(*)::int as recommendable_total,
        COUNT(CASE WHEN description IS NOT NULL AND TRIM(description) != '' THEN 1 END)::int as with_description,
        COUNT(CASE WHEN id IN (SELECT opportunity_id FROM opportunity_embeddings) THEN 1 END)::int as with_embedding,
        COUNT(CASE WHEN department IS NOT NULL AND department != '' THEN 1 END)::int as with_department,
        COUNT(CASE WHEN amount_known = true THEN 1 END)::int as with_amount
      FROM opportunities
      WHERE is_competitive = true
        AND status IN ('Published', 'Amended')
        AND (closing_date IS NULL OR closing_date >= NOW() - INTERVAL '7 days');
    `);

    const r = recRes.rows[0];
    const recTotal = r.recommendable_total;
    const descPct = recTotal > 0 ? (r.with_description / recTotal) * 100 : 0;
    const embPct = recTotal > 0 ? (r.with_embedding / recTotal) * 100 : 0;
    const deptPct = recTotal > 0 ? (r.with_department / recTotal) * 100 : 0;
    const amtPct = recTotal > 0 ? (r.with_amount / recTotal) * 100 : 0;

    cachedMetrics = {
      totalOpportunities,
      unknownCount,
      unknownPct,
      recTotal,
      descPct,
      embPct,
      deptPct,
      amtPct,
    };
    return cachedMetrics;
  } finally {
    await pool.end();
  }
}

async function runCheck7a(): Promise<CheckResult> {
  const name = 'own coverage';
  const config = loadVerifyConfig();
  if (!config) {
    return {
      id: '7a',
      name,
      status: 'FAIL',
      passed: false,
      reason: 'verify.config.json not found',
    };
  }

  try {
    const data = await fetchCoverageMetrics();
    const failures: string[] = [];
    if (data.recTotal < config.must.minRecommendableRows) {
      failures.push(
        `recommendable ${data.recTotal} < ${config.must.minRecommendableRows}`,
      );
    }
    if (data.descPct < config.must.minDescriptionPct) {
      failures.push(
        `description ${data.descPct.toFixed(1)}% < ${config.must.minDescriptionPct}%`,
      );
    }
    if (data.embPct < config.must.minEmbeddingPct) {
      failures.push(
        `embedding ${data.embPct.toFixed(1)}% < ${config.must.minEmbeddingPct}%`,
      );
    }

    if (failures.length > 0) {
      return {
        id: '7a',
        name,
        status: 'FAIL',
        passed: false,
        reason: failures.join(', '),
      };
    }
    return { id: '7a', name, status: 'PASS', passed: true };
  } catch (err: any) {
    return {
      id: '7a',
      name,
      status: 'FAIL',
      passed: false,
      reason: err.message || 'coverage query error',
    };
  }
}

async function runCheck7b(): Promise<CheckResult> {
  const name = 'source data quality';
  const config = loadVerifyConfig();
  if (!config) {
    return {
      id: '7b',
      name,
      status: 'FAIL',
      passed: false,
      reason: 'verify.config.json not found',
    };
  }

  try {
    const data = await fetchCoverageMetrics();
    const watch = config.watch;
    const parts: string[] = [];
    let hasFail = false;
    let hasWarn = false;

    // knownAmountPct: warn 90, fail 70
    if (data.amtPct < watch.knownAmountPct.fail) {
      hasFail = true;
      parts.push(
        `known amount ${data.amtPct.toFixed(1)}% < ${watch.knownAmountPct.fail}% (FAIL)`,
      );
    } else if (data.amtPct < watch.knownAmountPct.warn) {
      hasWarn = true;
      parts.push(
        `known amount ${data.amtPct.toFixed(1)}% < ${watch.knownAmountPct.warn}% (WARN)`,
      );
    } else {
      parts.push(`known amount ${data.amtPct.toFixed(1)}%`);
    }

    // knownDepartmentPct: warn 85, fail 60
    if (data.deptPct < watch.knownDepartmentPct.fail) {
      hasFail = true;
      parts.push(
        `known department ${data.deptPct.toFixed(1)}% < ${watch.knownDepartmentPct.fail}% (FAIL)`,
      );
    } else if (data.deptPct < watch.knownDepartmentPct.warn) {
      hasWarn = true;
      parts.push(
        `known department ${data.deptPct.toFixed(1)}% < ${watch.knownDepartmentPct.warn}% (WARN)`,
      );
    } else {
      parts.push(`known department ${data.deptPct.toFixed(1)}%`);
    }

    // unknownStatusPct: warn 1, fail 10
    if (data.unknownPct > watch.unknownStatusPct.fail) {
      hasFail = true;
      parts.push(
        `status Unknown ${data.unknownPct.toFixed(1)}% > ${watch.unknownStatusPct.fail}% (FAIL)`,
      );
    } else if (data.unknownPct > watch.unknownStatusPct.warn) {
      hasWarn = true;
      parts.push(
        `status Unknown ${data.unknownPct.toFixed(1)}% > ${watch.unknownStatusPct.warn}% (WARN)`,
      );
    } else {
      parts.push(`status Unknown ${data.unknownPct.toFixed(1)}%`);
    }

    const reason = parts.join(', ');
    if (hasFail) {
      return { id: '7b', name, status: 'FAIL', passed: false, reason };
    }
    if (hasWarn) {
      return { id: '7b', name, status: 'WARN', passed: true, reason };
    }
    return { id: '7b', name, status: 'PASS', passed: true, reason };
  } catch (err: any) {
    return {
      id: '7b',
      name,
      status: 'FAIL',
      passed: false,
      reason: err.message || 'coverage query error',
    };
  }
}

async function runCheck8(): Promise<CheckResult> {
  const name = 'eval gate and labels minimum';
  const labelsPath = path.resolve(process.cwd(), 'eval/labels.json');
  if (!fs.existsSync(labelsPath)) {
    return {
      id: 8,
      name,
      status: 'FAIL',
      passed: false,
      reason: 'eval/labels.json not found',
    };
  }

  const thresholdsPath = path.resolve(process.cwd(), 'eval/thresholds.json');
  let thresholds: EvalThresholds | null = null;
  if (fs.existsSync(thresholdsPath)) {
    try {
      thresholds = JSON.parse(fs.readFileSync(thresholdsPath, 'utf8'));
    } catch {
      thresholds = null;
    }
  }

  try {
    const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
    const evaluation = evaluateCheck8(labels, thresholds);
    if (!evaluation.passed) {
      return {
        id: 8,
        name,
        status: 'FAIL',
        passed: false,
        reason: evaluation.reason,
      };
    }

    execSync('pnpm eval:run', { stdio: 'pipe' });
    return { id: 8, name, status: 'PASS', passed: true };
  } catch (err: any) {
    return {
      id: 8,
      name,
      status: 'FAIL',
      passed: false,
      reason:
        err.stdout?.toString()?.trim() ||
        err.message ||
        'eval:run did not meet thresholds',
    };
  }
}

async function runCheck9(): Promise<CheckResult> {
  const name = 'no process.env reads under src/modules';
  try {
    const output = execSync(
      'grep -rn "process\\.env" src/modules --include=*.ts || true',
      { encoding: 'utf8' },
    );
    const nonSpecLines = output
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.includes('.spec.ts'));

    if (nonSpecLines.length > 0) {
      return {
        id: 9,
        name,
        status: 'FAIL',
        passed: false,
        reason: `found ${nonSpecLines.length} reads: ${nonSpecLines[0]}`,
      };
    }
    return { id: 9, name, status: 'PASS', passed: true };
  } catch (err: any) {
    return {
      id: 9,
      name,
      status: 'FAIL',
      passed: false,
      reason: err.message || 'grep check failed',
    };
  }
}

async function runCheck10(): Promise<CheckResult> {
  const name = 'git status is clean';
  try {
    const porcelain = execSync('git status --porcelain', {
      encoding: 'utf8',
    });
    const evaluation = evaluateCheck10(porcelain);
    if (!evaluation.passed) {
      return {
        id: 10,
        name,
        status: 'FAIL',
        passed: false,
        reason: evaluation.reason,
      };
    }

    return { id: 10, name, status: 'PASS', passed: true };
  } catch (err: any) {
    return {
      id: 10,
      name,
      status: 'FAIL',
      passed: false,
      reason: err.message || 'git status check error',
    };
  }
}

async function runCheck11(): Promise<CheckResult> {
  const name = 'docker compose config validates';
  try {
    execSync('docker compose config -q', { stdio: 'pipe' });
    return { id: 11, name, status: 'PASS', passed: true };
  } catch (err: any) {
    return {
      id: 11,
      name,
      status: 'FAIL',
      passed: false,
      reason: err.stderr?.toString()?.trim() || 'docker compose config failed',
    };
  }
}

async function main() {
  loadEnv();

  console.log('Running backend verification checks...\n');
  const checks = [
    runCheck1,
    runCheck2,
    runCheck3,
    runCheck4,
    runCheck5,
    runCheck6,
    runCheck7a,
    runCheck7b,
    runCheck8,
    runCheck9,
    runCheck10,
    runCheck11,
  ];

  const results: CheckResult[] = [];
  for (const check of checks) {
    const res = await check();
    results.push(res);
  }

  const { exitCode, lines } = aggregateResults(results);
  for (const line of lines) {
    console.log(line);
  }

  console.log(
    exitCode === 0
      ? '\nBackend verification PASSED. The backend is finished and ready for frontend work.'
      : '\nBackend verification completed with one or more FAILS.',
  );

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Unexpected error in verification script:', err);
  process.exit(1);
});
