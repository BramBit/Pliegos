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
    return { id: 1, name, passed: true };
  } catch (err: any) {
    return {
      id: 1,
      name,
      passed: false,
      reason: err.stderr?.toString()?.trim() || 'TypeScript type check failed',
    };
  }
}

async function runCheck2(): Promise<CheckResult> {
  const name = 'eslint (errors only)';
  try {
    execSync('pnpm exec eslint --quiet .', { stdio: 'pipe' });
    return { id: 2, name, passed: true };
  } catch (err: any) {
    return {
      id: 2,
      name,
      passed: false,
      reason: err.stdout?.toString()?.trim() || 'ESLint errors found',
    };
  }
}

async function runCheck3(): Promise<CheckResult> {
  const name = 'all tests (pnpm test)';
  try {
    execSync('pnpm test', { stdio: 'pipe' });
    return { id: 3, name, passed: true };
  } catch {
    return {
      id: 3,
      name,
      passed: false,
      reason: 'one or more test suites failed',
    };
  }
}

async function runCheck4(): Promise<CheckResult> {
  const name = 'check:arch reports no violation outside the baseline';
  try {
    execSync('pnpm check:arch', { stdio: 'pipe' });
    return { id: 4, name, passed: true };
  } catch {
    return {
      id: 4,
      name,
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
          passed: false,
          reason: 'first run applied 0 migrations',
        };
      }
      if (run2.applied.length !== 0) {
        return {
          id: 5,
          name,
          passed: false,
          reason: `second run applied ${run2.applied.length} migrations (expected 0)`,
        };
      }
      return { id: 5, name, passed: true };
    } finally {
      await verifyPool.end();
    }
  } catch (err: any) {
    return {
      id: 5,
      name,
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
        passed: false,
        reason: 'docs/openapi.json does not exist',
      };
    }

    const current = fs.readFileSync(openApiPath, 'utf8');
    if (current !== regenerated) {
      return {
        id: 6,
        name,
        passed: false,
        reason: 'docs/openapi.json differs from current API definition',
      };
    }
    return { id: 6, name, passed: true };
  } catch (err: any) {
    return {
      id: 6,
      name,
      passed: false,
      reason: err.message || 'failed to regenerate openapi spec',
    };
  }
}

async function runCheck7(): Promise<CheckResult> {
  const name = 'data coverage on real database';
  const configPath = path.resolve(process.cwd(), 'verify.config.json');
  if (!fs.existsSync(configPath)) {
    return {
      id: 7,
      name,
      passed: false,
      reason: 'verify.config.json not found',
    };
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return {
      id: 7,
      name,
      passed: false,
      reason: 'DATABASE_URL not set in environment',
    };
  }

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

    const failures: string[] = [];
    if (recTotal < config.minRecommendableRows) {
      failures.push(
        `recommendable ${recTotal} < ${config.minRecommendableRows}`,
      );
    }
    if (descPct < config.minDescriptionPct) {
      failures.push(
        `description ${descPct.toFixed(1)}% < ${config.minDescriptionPct}%`,
      );
    }
    if (embPct < config.minEmbeddingPct) {
      failures.push(
        `embedding ${embPct.toFixed(1)}% < ${config.minEmbeddingPct}%`,
      );
    }
    if (deptPct < config.minKnownDepartmentPct) {
      failures.push(
        `known department ${deptPct.toFixed(1)}% < ${config.minKnownDepartmentPct}%`,
      );
    }
    if (amtPct < config.minKnownAmountPct) {
      failures.push(
        `known amount ${amtPct.toFixed(1)}% < ${config.minKnownAmountPct}%`,
      );
    }
    if (unknownPct > config.maxUnknownStatusPct) {
      failures.push(
        `status Unknown ${unknownPct.toFixed(1)}% > ${config.maxUnknownStatusPct}%`,
      );
    }

    if (failures.length > 0) {
      return {
        id: 7,
        name,
        passed: false,
        reason: failures.join(', '),
      };
    }
    return { id: 7, name, passed: true };
  } catch (err: any) {
    return {
      id: 7,
      name,
      passed: false,
      reason: err.message || 'data coverage query error',
    };
  } finally {
    await pool.end();
  }
}

async function runCheck8(): Promise<CheckResult> {
  const name = 'eval gate and labels minimum';
  const labelsPath = path.resolve(process.cwd(), 'eval/labels.json');
  if (!fs.existsSync(labelsPath)) {
    return { id: 8, name, passed: false, reason: 'eval/labels.json not found' };
  }

  try {
    const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
    const requiredProfiles = ['golden-tech', 'golden-infra', 'golden-food'];

    for (const p of requiredProfiles) {
      const count = Object.keys(labels[p] || {}).length;
      if (count < 30) {
        return {
          id: 8,
          name,
          passed: false,
          reason: `profile ${p} has ${count} labels, expected >= 30`,
        };
      }
    }

    execSync('pnpm eval:run', { stdio: 'pipe' });
    return { id: 8, name, passed: true };
  } catch (err: any) {
    return {
      id: 8,
      name,
      passed: false,
      reason:
        err.stdout?.toString()?.trim() || 'eval:run did not meet thresholds',
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
        passed: false,
        reason: `found ${nonSpecLines.length} reads: ${nonSpecLines[0]}`,
      };
    }
    return { id: 9, name, passed: true };
  } catch (err: any) {
    return {
      id: 9,
      name,
      passed: false,
      reason: err.message || 'grep check failed',
    };
  }
}

async function runCheck10(): Promise<CheckResult> {
  const name = 'git status clean and no attribution in git log';
  try {
    const attributionMatches = execSync(
      "git log --format=%B | grep -Eic 'co-authored-by|generated with|generated by|signed-off-by|claude|gemini|anthropic|openai|copilot|ai-assisted|\\bagy\\b|🤖' || true",
      { encoding: 'utf8' },
    ).trim();

    const count = parseInt(attributionMatches, 10) || 0;
    if (count > 0) {
      return {
        id: 10,
        name,
        passed: false,
        reason: `found ${count} commit messages matching forbidden attribution patterns`,
      };
    }

    const porcelain = execSync('git status --porcelain', {
      encoding: 'utf8',
    }).trim();
    const lines = porcelain ? porcelain.split('\n') : [];
    const dirty = lines.filter((line) => {
      const file = line.slice(3).trim();
      if (file.startsWith('docs/handoff') || file === 'eval/LABELING.md') {
        return false;
      }
      return true;
    });

    if (dirty.length > 0) {
      return {
        id: 10,
        name,
        passed: false,
        reason: `uncommitted changes found (${dirty.length} files: ${dirty
          .slice(0, 3)
          .map((l) => l.slice(3).trim())
          .join(', ')}${dirty.length > 3 ? '...' : ''})`,
      };
    }

    return { id: 10, name, passed: true };
  } catch (err: any) {
    return {
      id: 10,
      name,
      passed: false,
      reason: err.message || 'git status check error',
    };
  }
}

async function runCheck11(): Promise<CheckResult> {
  const name = 'docker compose config validates';
  try {
    execSync('docker compose config -q', { stdio: 'pipe' });
    return { id: 11, name, passed: true };
  } catch (err: any) {
    return {
      id: 11,
      name,
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
    runCheck7,
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
