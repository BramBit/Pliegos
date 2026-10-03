import { Pool } from 'pg';
import { PostgresAlertRepository } from './postgres-alert.repository';
import { initDatabaseSchema } from '../../../../shared/infrastructure/persistence/database.schema';
import { Alert } from '../../../domain/entities/alert.entity';
import {
  asAlertId,
  asProfileId,
  asOpportunityId,
} from '../../../../shared/domain/typed-id';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/pliegos_test';

describe('PostgresAlertRepository (Real Test Database)', () => {
  let pool: Pool;
  let repo: PostgresAlertRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await initDatabaseSchema(pool);
    repo = new PostgresAlertRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM alerts;');
  });

  it('saves an alert and finds only undelivered alerts', async () => {
    const alert1: Alert = {
      id: asAlertId('alert-1'),
      profileId: asProfileId('prof-1'),
      opportunityId: asOpportunityId('opp-1'),
      trigger: 'Amendment',
      deliveredAt: null,
    };

    const alert2: Alert = {
      id: asAlertId('alert-2'),
      profileId: asProfileId('prof-2'),
      opportunityId: asOpportunityId('opp-2'),
      trigger: 'DeadlineApproaching',
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
});
