import { requireTestDatabaseUrl } from '../../../../shared/testing/test-database-url';
import { Pool } from 'pg';
import { PostgresProfileRepository } from './postgres-profile.repository';
import { migrateTestDatabase } from '../../../../shared/testing/migrate-test-database';
import { Profile } from '../../../domain/entities/profile.entity';
import { asProfileId, asUserId } from '../../../../shared/domain/typed-id';

const TEST_DATABASE_URL = requireTestDatabaseUrl();

describe('PostgresProfileRepository (Real Test Database)', () => {
  let pool: Pool;
  let repo: PostgresProfileRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await migrateTestDatabase(pool);
    repo = new PostgresProfileRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM profiles;');
  });

  it('persists and retrieves a profile with preferences and capabilities', async () => {
    const profile: Profile = {
      id: asProfileId('prof-1'),
      ownerId: asUserId('user-1'),
      sector: 'Tecnologia y Telecomunicaciones',
      capabilities: [
        { name: 'Desarrollo Cloud', yearsOfExperience: 5 },
        { name: 'Seguridad Informatica', yearsOfExperience: 3 },
      ],
      preferences: {
        categoryCodes: ['V1.43230000', 'V1.81111500'],
        keywords: ['software', 'cloud', 'seguridad'],
        amountRange: { min: 50_000_000, max: 300_000_000 },
        departments: ['Antioquia', 'Bogota D.C.'],
      },
    };

    await repo.save(profile);

    const retrieved = await repo.findById(profile.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(profile.id);
    expect(retrieved?.ownerId).toBe(profile.ownerId);
    expect(retrieved?.sector).toBe(profile.sector);
    expect(retrieved?.capabilities).toEqual(profile.capabilities);
    expect(retrieved?.preferences.categoryCodes).toEqual(profile.preferences.categoryCodes);
    expect(retrieved?.preferences.amountRange).toEqual({ min: 50_000_000, max: 300_000_000 });
    expect(retrieved?.preferences.departments).toEqual(['Antioquia', 'Bogota D.C.']);
  });

  it('updates profile preferences and capabilities on upsert', async () => {
    const profile: Profile = {
      id: asProfileId('prof-upsert'),
      ownerId: asUserId('user-2'),
      sector: 'Construccion',
      capabilities: [{ name: 'Vias', yearsOfExperience: 10 }],
      preferences: {
        categoryCodes: ['V1.72120000'],
        keywords: ['asfalto'],
        amountRange: null,
        departments: [],
      },
    };

    await repo.save(profile);

    const updated: Profile = {
      ...profile,
      sector: 'Ingenieria Civil y Construccion',
      capabilities: [
        { name: 'Vias', yearsOfExperience: 10 },
        { name: 'Puentes', yearsOfExperience: 4 },
      ],
    };

    await repo.save(updated);

    const retrieved = await repo.findById(profile.id);
    expect(retrieved?.sector).toBe('Ingenieria Civil y Construccion');
    expect(retrieved?.capabilities).toHaveLength(2);
  });

  it('returns null when profile is not found', async () => {
    const notFound = await repo.findById(asProfileId('missing-id'));
    expect(notFound).toBeNull();
  });

  it('finds profiles by ownerId', async () => {
    const p1: Profile = {
      id: asProfileId('prof-owner-1'),
      ownerId: asUserId('owner-abc'),
      name: 'Perfil 1',
      contactEmail: 'p1@test.com',
      alertsEnabled: true,
      deadlineAlertDays: 3,
      sector: 'Sector 1',
      capabilities: [],
      preferences: { categoryCodes: [], keywords: [], amountRange: null, departments: [] },
    };
    const p2: Profile = {
      id: asProfileId('prof-owner-2'),
      ownerId: asUserId('owner-abc'),
      name: 'Perfil 2',
      contactEmail: 'p2@test.com',
      alertsEnabled: false,
      deadlineAlertDays: 5,
      sector: 'Sector 2',
      capabilities: [],
      preferences: { categoryCodes: [], keywords: [], amountRange: null, departments: [] },
    };
    await repo.save(p1);
    await repo.save(p2);

    const owned = await repo.findByOwner(asUserId('owner-abc'));
    expect(owned).toHaveLength(2);
    expect(owned.map((p) => p.id)).toContain('prof-owner-1');
    expect(owned.map((p) => p.id)).toContain('prof-owner-2');
  });

  it('deletes profile and cascades delete to recommendations', async () => {
    const profileId = asProfileId('prof-cascade-del');
    const profile: Profile = {
      id: profileId,
      ownerId: asUserId('owner-cascade'),
      name: 'Perfil Cascade',
      contactEmail: 'cascade@test.com',
      alertsEnabled: true,
      deadlineAlertDays: 3,
      sector: 'Sector Cascade',
      capabilities: [],
      preferences: { categoryCodes: [], keywords: [], amountRange: null, departments: [] },
    };
    await repo.save(profile);

    // Insert an opportunity and a recommendation referencing this profile
    const oppId = 'opp-cascade-ref';
    await pool.query(`
      INSERT INTO opportunities (
        id, title, description, contracting_entity_name, contracting_entity_tax_id,
        city, department, amount, amount_known, currency, contract_type,
        procurement_modality, is_competitive, category_code, published_at,
        last_published_at, closing_date, is_open_for_submission, status,
        source_name, source_external_id, source_human_reference, source_original_url
      ) VALUES (
        $1, 'Title', 'Desc', 'Entity', '900', 'Bogota', 'Cundinamarca', 100, true,
        'COP', 'Servicios', 'Licitacion', true, '43230000', NOW(), NOW(), NOW() + interval '1 day',
        true, 'Published', 'SECOP', 'EXT-CASC-1', 'REF-1', 'http://url'
      ) ON CONFLICT (id) DO NOTHING;
    `, [oppId]);

    const recId = 'rec-cascade-ref';
    await pool.query(`
      INSERT INTO recommendations (
        id, profile_id, opportunity_id, score, explanation, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 0.85, '{"summary":"test","matchedFactors":[]}'::jsonb, NOW(), NOW()
      );
    `, [recId, profileId, oppId]);

    // Verify recommendation exists
    const beforeCount = await pool.query(
      'SELECT COUNT(*) FROM recommendations WHERE profile_id = $1',
      [profileId],
    );
    expect(Number(beforeCount.rows[0].count)).toBe(1);

    // Delete profile
    const deleted = await repo.delete(profileId);
    expect(deleted).toBe(true);

    // Verify profile is deleted
    expect(await repo.findById(profileId)).toBeNull();

    // Verify recommendations were cascade deleted by PostgreSQL
    const afterCount = await pool.query(
      'SELECT COUNT(*) FROM recommendations WHERE profile_id = $1',
      [profileId],
    );
    expect(Number(afterCount.rows[0].count)).toBe(0);
  });
});
