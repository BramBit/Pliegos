import { Pool } from 'pg';
import { PostgresProfileRepository } from './postgres-profile.repository';
import { initDatabaseSchema } from '../../../../shared/infrastructure/persistence/database.schema';
import { Profile } from '../../../domain/entities/profile.entity';
import { asProfileId, asUserId } from '../../../../shared/domain/typed-id';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/pliegos_test';

describe('PostgresProfileRepository (Real Test Database)', () => {
  let pool: Pool;
  let repo: PostgresProfileRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await initDatabaseSchema(pool);
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
});
