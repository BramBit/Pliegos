import { Pool } from 'pg';
import { PostgresOpportunityRepository } from './postgres-opportunity.repository';
import { initDatabaseSchema } from '../../../../shared/infrastructure/persistence/database.schema';
import { Opportunity } from '../../../domain/entities/opportunity.entity';
import { asOpportunityId } from '../../../../shared/domain/typed-id';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/pliegos_test';

describe('PostgresOpportunityRepository (Real Test Database)', () => {
  let pool: Pool;
  let repo: PostgresOpportunityRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await initDatabaseSchema(pool);
    repo = new PostgresOpportunityRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM opportunities;');
  });

  const createSampleOpportunity = (overrides?: Partial<Opportunity>): Opportunity => ({
    id: asOpportunityId('opp-test-1'),
    title: 'Suministro de equipos de computo',
    contractingEntity: {
      name: 'Alcaldia de Medellin',
      taxId: '890905211',
    },
    location: {
      city: 'Medellin',
      department: 'Antioquia',
    },
    amount: {
      amount: 150_000_000,
      currency: 'COP',
    },
    contractType: 'Suministro',
    procurementModality: 'Seleccion abreviada',
    categoryCode: 'V1.43211500',
    publishedAt: new Date('2026-03-01T10:00:00.000Z'),
    closingDate: new Date('2026-03-20T17:00:00.000Z'),
    isOpenForSubmission: true,
    status: 'Published',
    source: {
      sourceName: 'SECOP',
      externalId: 'CO1.REQ.5555',
      humanReference: 'MED-SUM-2026',
      originalUrl: 'https://community.secop.gov.co/5555',
    },
    analysis: {
      summary: 'Compra de 100 computadores portatiles para colegios',
      requirements: [{ text: 'Garantia 3 anos', type: 'technical' }],
      embeddingGeneratedAt: null,
    },
    changeHistory: [],
    ...overrides,
  });

  it('saves and retrieves an opportunity by ID from real database', async () => {
    const opp = createSampleOpportunity();
    await repo.save(opp);

    const found = await repo.findById(opp.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(opp.id);
    expect(found?.title).toBe(opp.title);
    expect(found?.contractingEntity).toEqual(opp.contractingEntity);
    expect(found?.location).toEqual(opp.location);
    expect(found?.amount).toEqual(opp.amount);
    expect(found?.categoryCode).toBe('V1.43211500');
    expect(found?.closingDate).toEqual(opp.closingDate);
    expect(found?.analysis?.summary).toBe('Compra de 100 computadores portatiles para colegios');
  });

  it('updates an existing opportunity on conflict (upsert)', async () => {
    const opp = createSampleOpportunity();
    await repo.save(opp);

    const updatedOpp: Opportunity = {
      ...opp,
      title: 'Suministro de equipos de computo - Adenda 1',
      status: 'Amended',
      changeHistory: [
        {
          field: 'closingDate',
          previousValue: opp.closingDate!.toISOString(),
          newValue: '2026-03-25T17:00:00.000Z',
          detectedAt: new Date('2026-03-10T12:00:00.000Z'),
        },
      ],
    };

    await repo.save(updatedOpp);

    const found = await repo.findById(opp.id);
    expect(found?.title).toBe('Suministro de equipos de computo - Adenda 1');
    expect(found?.status).toBe('Amended');
    expect(found?.changeHistory).toHaveLength(1);
    expect(found?.changeHistory[0].field).toBe('closingDate');
  });

  it('finds opportunity by external source ID (SECOP ID)', async () => {
    const opp = createSampleOpportunity();
    await repo.save(opp);

    const found = await repo.findByExternalId('CO1.REQ.5555');
    expect(found).not.toBeNull();
    expect(found?.id).toBe(opp.id);
    expect(found?.source.externalId).toBe('CO1.REQ.5555');
  });

  it('returns null when searching for non-existent ID or external ID', async () => {
    expect(await repo.findById(asOpportunityId('non-existent'))).toBeNull();
    expect(await repo.findByExternalId('non-existent-ext')).toBeNull();
  });

  it('filters opportunities by category prefix, department, and amount range', async () => {
    const opp1 = createSampleOpportunity({
      id: asOpportunityId('opp-1'),
      source: {
        sourceName: 'SECOP',
        externalId: 'EXT-1',
        humanReference: 'REF-1',
        originalUrl: 'https://secop.gov.co/1',
      },
      categoryCode: 'V1.43211500',
      location: { city: 'Medellin', department: 'Antioquia' },
      amount: { amount: 100_000_000, currency: 'COP' },
    });

    const opp2 = createSampleOpportunity({
      id: asOpportunityId('opp-2'),
      source: {
        sourceName: 'SECOP',
        externalId: 'EXT-2',
        humanReference: 'REF-2',
        originalUrl: 'https://secop.gov.co/2',
      },
      categoryCode: 'V1.72121400',
      location: { city: 'Bogota', department: 'Cundinamarca' },
      amount: { amount: 500_000_000, currency: 'COP' },
    });

    await repo.save(opp1);
    await repo.save(opp2);

    const filteredByCategory = await repo.findByFilters({ categoryCode: 'V1.43' });
    expect(filteredByCategory).toHaveLength(1);
    expect(filteredByCategory[0].id).toBe('opp-1');

    const filteredByDept = await repo.findByFilters({ department: 'Antioquia' });
    expect(filteredByDept).toHaveLength(1);
    expect(filteredByDept[0].id).toBe('opp-1');

    const filteredByAmount = await repo.findByFilters({
      amountMin: 200_000_000,
      amountMax: 600_000_000,
    });
    expect(filteredByAmount).toHaveLength(1);
    expect(filteredByAmount[0].id).toBe('opp-2');
  });
});
