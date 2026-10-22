import { seedProfile, seedOpportunity } from '../../../../shared/testing/seed';
import { requireTestDatabaseUrl } from '../../../../shared/testing/test-database-url';
import { Pool } from 'pg';
import { PostgresAlertRepository } from './postgres-alert.repository';
import { migrateTestDatabase } from '../../../../shared/testing/migrate-test-database';
import { Alert } from '../../../domain/entities/alert.entity';
import {
  asAlertId,
  asProfileId,
  asOpportunityId,
} from '../../../../shared/domain/typed-id';

const TEST_DATABASE_URL = requireTestDatabaseUrl();

describe('PostgresAlertRepository (Real Test Database)', () => {
  let pool: Pool;
  let repo: PostgresAlertRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await migrateTestDatabase(pool);
    repo = new PostgresAlertRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM alerts;');
    for (const id of ['prof-1', 'prof-2', 'prof-3'])
      await seedProfile(pool, id);
  });

  it('saves an alert and finds only undelivered alerts', async () => {
    const alert1: Alert = {
      id: asAlertId('alert-1'),
      profileId: asProfileId('prof-1'),
      opportunityId: asOpportunityId('opp-1'),
      trigger: 'Amendment',
      changeKey: '',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };

    const alert2: Alert = {
      id: asAlertId('alert-2'),
      profileId: asProfileId('prof-2'),
      opportunityId: asOpportunityId('opp-2'),
      trigger: 'DeadlineApproaching',
      changeKey: '',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: new Date('2026-03-01T08:00:00.000Z'),
    };

    await repo.save(alert1);
    await repo.save(alert2);

    const undelivered = await repo.findUndelivered();
    expect(undelivered).toHaveLength(1);
    expect(undelivered[0].id).toBe('alert-1');
    expect(undelivered[0].trigger).toBe('Amendment');
    expect(undelivered[0].deliveredAt).toBeNull();
  });

  it('marks an alert as delivered on update', async () => {
    const alert: Alert = {
      id: asAlertId('alert-del'),
      profileId: asProfileId('prof-3'),
      opportunityId: asOpportunityId('opp-3'),
      trigger: 'StatusChange',
      changeKey: '',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };

    await repo.save(alert);
    expect(await repo.findUndelivered()).toHaveLength(1);

    const delivered: Alert = {
      ...alert,
      deliveredAt: new Date('2026-03-02T12:00:00.000Z'),
    };

    await repo.save(delivered);

    const remainingUndelivered = await repo.findUndelivered();
    expect(remainingUndelivered).toHaveLength(0);
  });

  it('inserts multiple alerts with createMany and ignores duplicates on conflict', async () => {
    const alerts: Alert[] = [
      {
        id: asAlertId('alert-m1'),
        profileId: asProfileId('prof-1'),
        opportunityId: asOpportunityId('opp-1'),
        trigger: 'Amendment',
        changeKey: 'amount:2026-10-18T00:00:00.000Z',
        attempts: 0,
        lastError: null,
        readAt: null,
        deliveredAt: null,
      },
      {
        id: asAlertId('alert-m2'),
        profileId: asProfileId('prof-2'),
        opportunityId: asOpportunityId('opp-2'),
        trigger: 'StatusChange',
        changeKey: 'status:2026-10-18T00:00:00.000Z',
        attempts: 0,
        lastError: null,
        readAt: null,
        deliveredAt: null,
      },
    ];

    await repo.createMany(alerts);

    const undelivered = await repo.findUndelivered();
    expect(undelivered).toHaveLength(2);

    // Attempting to re-insert the same alert (same profile, opp, trigger, changeKey) but different id
    const duplicateAlert: Alert = {
      id: asAlertId('alert-m3-duplicate'),
      profileId: asProfileId('prof-1'),
      opportunityId: asOpportunityId('opp-1'),
      trigger: 'Amendment',
      changeKey: 'amount:2026-10-18T00:00:00.000Z',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };

    await repo.createMany([duplicateAlert]);

    // Count should still be 2 due to ON CONFLICT DO NOTHING
    const undeliveredAfter = await repo.findUndelivered();
    expect(undeliveredAfter).toHaveLength(2);
  });

  it('limits undelivered alerts when limit is provided', async () => {
    const alerts: Alert[] = [
      {
        id: asAlertId('alert-lim-1'),
        profileId: asProfileId('prof-1'),
        opportunityId: asOpportunityId('opp-1'),
        trigger: 'Amendment',
        changeKey: 'k1',
        attempts: 0,
        lastError: null,
        readAt: null,
        deliveredAt: null,
      },
      {
        id: asAlertId('alert-lim-2'),
        profileId: asProfileId('prof-2'),
        opportunityId: asOpportunityId('opp-2'),
        trigger: 'Amendment',
        changeKey: 'k2',
        attempts: 0,
        lastError: null,
        readAt: null,
        deliveredAt: null,
      },
    ];

    await repo.createMany(alerts);

    const limited = await repo.findUndelivered(1);
    expect(limited).toHaveLength(1);
  });

  it('increments attempts and updates last_error on markFailed', async () => {
    const alert: Alert = {
      id: asAlertId('alert-fail-1'),
      profileId: asProfileId('prof-1'),
      opportunityId: asOpportunityId('opp-1'),
      trigger: 'Amendment',
      changeKey: 'kfail',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };

    await repo.save(alert);
    await repo.markFailed(alert.id, 'SMTP timeout');

    const found = await repo.findById(alert.id);
    expect(found).not.toBeNull();
    expect(found?.attempts).toBe(1);
    expect(found?.lastError).toBe('SMTP timeout');
  });

  it('finds alerts by profile paginated with opportunity summary', async () => {
    // Seed an opportunity so the LEFT JOIN has opportunity data
    await seedOpportunity(pool, 'opp-inbox-1');
    await pool.query(
      `UPDATE opportunities
       SET title = 'Licitación Vial Cali',
           contracting_entity_name = 'Alcaldía de Cali',
           amount = 150000000,
           closing_date = NOW() + interval '5 days'
       WHERE id = 'opp-inbox-1';`,
    );

    const alert1: Alert = {
      id: asAlertId('alt-inbox-1'),
      profileId: asProfileId('prof-1'),
      opportunityId: asOpportunityId('opp-inbox-1'),
      trigger: 'Amendment',
      changeKey: 'amount:2026-10-18',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };
    const alert2: Alert = {
      id: asAlertId('alt-inbox-2'),
      profileId: asProfileId('prof-1'),
      opportunityId: asOpportunityId('opp-inbox-1'),
      trigger: 'DeadlineApproaching',
      changeKey: 'deadline:2026-10-25',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };

    await repo.save(alert1);
    await repo.save(alert2);

    const page1 = await repo.findByProfile(asProfileId('prof-1'), 1, 10);
    expect(page1.total).toBe(2);
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].opportunitySummary.title).toBe(
      'Licitación Vial Cali',
    );
    expect(page1.items[0].opportunitySummary.entity).toBe('Alcaldía de Cali');
    expect(page1.items[0].opportunitySummary.amount).toBe(150000000);
    expect(page1.items[0].opportunitySummary.closingDate).toBeInstanceOf(Date);
  });

  it('marks a single alert as read and is idempotent', async () => {
    const alert: Alert = {
      id: asAlertId('alt-read-1'),
      profileId: asProfileId('prof-2'),
      opportunityId: asOpportunityId('opp-1'),
      trigger: 'StatusChange',
      changeKey: 'status:1',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };
    await repo.save(alert);

    const marked = await repo.markRead(alert.id);
    expect(marked).toBe(true);

    const found = await repo.findById(alert.id);
    expect(found?.readAt).toBeInstanceOf(Date);

    // Idempotent: calling again succeeds
    const markedAgain = await repo.markRead(alert.id);
    expect(markedAgain).toBe(true);
  });

  it('marks all unread alerts for a profile as read', async () => {
    const a1: Alert = {
      id: asAlertId('alt-all-1'),
      profileId: asProfileId('prof-3'),
      opportunityId: asOpportunityId('opp-1'),
      trigger: 'Amendment',
      changeKey: 'k1',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };
    const a2: Alert = {
      id: asAlertId('alt-all-2'),
      profileId: asProfileId('prof-3'),
      opportunityId: asOpportunityId('opp-2'),
      trigger: 'DeadlineApproaching',
      changeKey: 'k2',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };
    await repo.save(a1);
    await repo.save(a2);

    const count = await repo.markAllRead(asProfileId('prof-3'));
    expect(count).toBe(2);

    const a1After = await repo.findById(a1.id);
    const a2After = await repo.findById(a2.id);
    expect(a1After?.readAt).toBeInstanceOf(Date);
    expect(a2After?.readAt).toBeInstanceOf(Date);

    // If all are already read, markAllRead returns 0
    const countAgain = await repo.markAllRead(asProfileId('prof-3'));
    expect(countAgain).toBe(0);
  });
});
