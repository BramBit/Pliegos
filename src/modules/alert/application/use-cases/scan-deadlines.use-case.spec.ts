import { Pool } from 'pg';
import { requireTestDatabaseUrl } from '../../../shared/testing/test-database-url';
import { migrateTestDatabase } from '../../../shared/testing/migrate-test-database';
import { seedProfile, seedOpportunity } from '../../../shared/testing/seed';
import { PostgresAlertRepository } from '../../infrastructure/adapters/persistence/postgres-alert.repository';
import { ScanDeadlinesUseCase } from './scan-deadlines.use-case';
import { FixedClock } from '../../../shared/domain/clock';
import { asOpportunityId, asProfileId, asRecommendationId } from '../../../shared/domain/typed-id';

const TEST_DATABASE_URL = requireTestDatabaseUrl();

describe('ScanDeadlinesUseCase (Real Test Database & FixedClock)', () => {
  let pool: Pool;
  let alertRepo: PostgresAlertRepository;
  const baseTime = new Date('2026-10-19T08:00:00.000Z');
  let clock: FixedClock;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await migrateTestDatabase(pool);
    alertRepo = new PostgresAlertRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM alerts;');
    await pool.query('DELETE FROM watches;');
    await pool.query('DELETE FROM recommendations;');
    await pool.query('DELETE FROM opportunities;');
    await pool.query('DELETE FROM profiles;');

    clock = new FixedClock(baseTime);
  });

  it('closing in 2 days with a 3-day preference creates one alert; running again creates none; a changed closing date creates a new one', async () => {
    const profileId = asProfileId('prof-deadline-1');
    const oppId = asOpportunityId('opp-deadline-1');

    await seedProfile(pool, profileId);
    // Profile with 3-day preference and alerts enabled
    await pool.query(
      'UPDATE profiles SET deadline_alert_days = 3, alerts_enabled = true WHERE id = $1;',
      [profileId],
    );

    // Opportunity closing in 2 days: 2026-10-21T17:00:00.000Z
    const closingDate1 = new Date('2026-10-21T17:00:00.000Z');
    await seedOpportunity(pool, oppId);
    await pool.query('UPDATE opportunities SET closing_date = $1 WHERE id = $2;', [
      closingDate1,
      oppId,
    ]);

    // Add watch on the opportunity
    await pool.query('INSERT INTO watches (profile_id, opportunity_id) VALUES ($1, $2);', [
      profileId,
      oppId,
    ]);

    const useCase = new ScanDeadlinesUseCase(pool, alertRepo, clock);

    // 1. First run: should create 1 DeadlineApproaching alert
    const res1 = await useCase.execute();
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.value.alertsCreated).toBe(1);
    }

    const alerts1 = await alertRepo.findUndelivered();
    expect(alerts1).toHaveLength(1);
    expect(alerts1[0].profileId).toBe(profileId);
    expect(alerts1[0].opportunityId).toBe(oppId);
    expect(alerts1[0].trigger).toBe('DeadlineApproaching');
    expect(alerts1[0].changeKey).toBe('deadline:2026-10-21');

    // 2. Second run with same date: should create none (idempotent)
    const res2 = await useCase.execute();
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.value.alertsCreated).toBe(0);
    }

    const alerts2 = await alertRepo.findUndelivered();
    expect(alerts2).toHaveLength(1);

    // 3. Changed closing date: update closing date to 2026-10-22 (still within 3 days)
    const closingDate2 = new Date('2026-10-22T12:00:00.000Z');
    await pool.query('UPDATE opportunities SET closing_date = $1 WHERE id = $2;', [
      closingDate2,
      oppId,
    ]);

    const res3 = await useCase.execute();
    expect(res3.ok).toBe(true);
    if (res3.ok) {
      expect(res3.value.alertsCreated).toBe(1);
    }

    const alerts3 = await alertRepo.findUndelivered();
    expect(alerts3).toHaveLength(2);
    expect(alerts3.map((a) => a.changeKey).sort()).toEqual([
      'deadline:2026-10-21',
      'deadline:2026-10-22',
    ]);
  });

  it('creates no alerts when the opportunity closes outside the alert window (e.g. 5 days with a 3-day preference)', async () => {
    const profileId = asProfileId('prof-deadline-far');
    const oppId = asOpportunityId('opp-deadline-far');

    await seedProfile(pool, profileId);
    await pool.query('UPDATE profiles SET deadline_alert_days = 3 WHERE id = $1;', [profileId]);

    // Closing in 5 days
    const closingFar = new Date('2026-10-24T12:00:00.000Z');
    await seedOpportunity(pool, oppId);
    await pool.query('UPDATE opportunities SET closing_date = $1 WHERE id = $2;', [
      closingFar,
      oppId,
    ]);
    await pool.query('INSERT INTO watches (profile_id, opportunity_id) VALUES ($1, $2);', [
      profileId,
      oppId,
    ]);

    const useCase = new ScanDeadlinesUseCase(pool, alertRepo, clock);
    const res = await useCase.execute();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.alertsCreated).toBe(0);
    }

    expect(await alertRepo.findUndelivered()).toHaveLength(0);
  });

  it('creates no alerts for profiles that have alerts_enabled = false', async () => {
    const profileId = asProfileId('prof-deadline-disabled');
    const oppId = asOpportunityId('opp-deadline-disabled');

    await seedProfile(pool, profileId);
    await pool.query(
      'UPDATE profiles SET deadline_alert_days = 3, alerts_enabled = false WHERE id = $1;',
      [profileId],
    );

    const closingSoon = new Date('2026-10-20T12:00:00.000Z');
    await seedOpportunity(pool, oppId);
    await pool.query('UPDATE opportunities SET closing_date = $1 WHERE id = $2;', [
      closingSoon,
      oppId,
    ]);
    await pool.query('INSERT INTO watches (profile_id, opportunity_id) VALUES ($1, $2);', [
      profileId,
      oppId,
    ]);

    const useCase = new ScanDeadlinesUseCase(pool, alertRepo, clock);
    const res = await useCase.execute();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.alertsCreated).toBe(0);
    }

    expect(await alertRepo.findUndelivered()).toHaveLength(0);
  });

  it('skips execution gracefully when advisory lock is held by another process', async () => {
    const client = await pool.connect();
    await client.query("SELECT pg_advisory_lock(hashtext('scan-deadlines'))");

    try {
      const useCase = new ScanDeadlinesUseCase(pool, alertRepo, clock);
      const res = await useCase.execute();

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.skipped).toBe(true);
        expect(res.value.reason).toBe('lock_busy');
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('scan-deadlines'))");
      client.release();
    }
  });

  it('creates alerts for top 5 new recommendations closing within 3 days when recommendDeadlineAlerts is true', async () => {
    const profileId = asProfileId('prof-rec-alerts');
    await seedProfile(pool, profileId);
    await pool.query(
      'UPDATE profiles SET deadline_alert_days = 1, alerts_enabled = true WHERE id = $1;',
      [profileId],
    );

    // Create 7 recommendations closing in 2 days with feedback = null (NEW)
    const closingIn2Days = new Date('2026-10-21T10:00:00.000Z');

    for (let i = 1; i <= 7; i++) {
      const oppId = asOpportunityId(`opp-rec-${i}`);
      await seedOpportunity(pool, oppId);
      await pool.query('UPDATE opportunities SET closing_date = $1 WHERE id = $2;', [
        closingIn2Days,
        oppId,
      ]);

      await pool.query(
        `INSERT INTO recommendations (id, profile_id, opportunity_id, score, explanation, feedback)
         VALUES ($1, $2, $3, $4, $5, NULL);`,
        [
          asRecommendationId(`rec-${i}`),
          profileId,
          oppId,
          0.5 + i * 0.05, // scores: 0.55 .. 0.85
          JSON.stringify({ summary: `Rec ${i}` }),
        ],
      );
    }

    const useCase = new ScanDeadlinesUseCase(pool, alertRepo, clock, undefined, true);
    const res = await useCase.execute();

    expect(res.ok).toBe(true);
    if (res.ok) {
      // Exactly top 5 should get alerts
      expect(res.value.alertsCreated).toBe(5);
    }

    const alerts = await alertRepo.findUndelivered();
    expect(alerts).toHaveLength(5);
    expect(alerts.every((a) => a.trigger === 'DeadlineApproaching')).toBe(true);
    expect(alerts.every((a) => a.changeKey === 'deadline:2026-10-21')).toBe(true);
  });
});
