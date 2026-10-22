import { Pool } from 'pg';
import { requireTestDatabaseUrl } from '../../../../shared/testing/test-database-url';
import { migrateTestDatabase } from '../../../../shared/testing/migrate-test-database';
import { PostgresOpportunityRepository } from './postgres-opportunity.repository';
import { Opportunity } from '../../../domain/entities/opportunity.entity';
import { asOpportunityId } from '../../../../shared/domain/typed-id';
import {
  evaluateCriteria,
  Criteria,
} from '../../../domain/services/criteria-evaluator';

const TEST_DATABASE_URL = requireTestDatabaseUrl();

describe('Tiered Search & Hard Exclusions (P8.2 Integration)', () => {
  let pool: Pool;
  let repo: PostgresOpportunityRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await migrateTestDatabase(pool);
    repo = new PostgresOpportunityRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM opportunities;');
  });

  const makeOpp = (overrides?: Partial<Opportunity>): Opportunity => {
    const id =
      overrides?.id ??
      asOpportunityId(`opp-${Math.random().toString(36).slice(2, 9)}`);
    return {
      id,
      title: 'Proceso de prueba',
      description: 'Descripcion del proceso',
      contractingEntity: {
        name: 'Entidad Estatal',
        taxId: '900123456',
      },
      location: {
        city: 'Bogota',
        department: 'Bogotá D.C.',
        departmentRaw: 'Bogotá D.C.',
      },
      amount: {
        amount: 100_000_000,
        currency: 'COP',
      },
      amountKnown: true,
      contractType: 'Servicios',
      procurementModality: 'Licitacion',
      isCompetitive: true,
      categoryCode: '81111500',
      publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      lastPublishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      closingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      isOpenForSubmission: true,
      status: 'Published',
      source: {
        sourceName: 'SECOP',
        externalId: `EXT-${id}`,
        humanReference: `REF-${id}`,
        originalUrl: `https://secop.gov.co/${id}`,
      },
      analysis: null,
      changeHistory: [],
      ...overrides,
    };
  };

  it('empty request returns recommendable rows and never returns Awarded, Cancelled, expired or non-competitive', async () => {
    const recommendable = makeOpp({
      id: asOpportunityId('rec-1'),
      status: 'Published',
    });
    const awarded = makeOpp({
      id: asOpportunityId('awd-1'),
      status: 'Awarded',
    });
    const cancelled = makeOpp({
      id: asOpportunityId('cnc-1'),
      status: 'Cancelled',
    });
    const nonCompetitive = makeOpp({
      id: asOpportunityId('dir-1'),
      isCompetitive: false,
    });
    const expired = makeOpp({
      id: asOpportunityId('exp-1'),
      closingDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    await repo.saveMany([
      recommendable,
      awarded,
      cancelled,
      nonCompetitive,
      expired,
    ]);

    const res = await repo.findPaged({});
    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe('rec-1');
    expect(res.items[0].matchTier).toBe(1);
    expect(res.tierCounts).toEqual({ 1: 1, 2: 0, 3: 0 });
  });

  it('null department with a department filter appears in tier 2 with missingCriteria [department]', async () => {
    const opp = makeOpp({
      id: asOpportunityId('null-dept-1'),
      location: { city: null, department: null },
    });
    await repo.save(opp);

    const res = await repo.findPaged({ department: 'Antioquia' });
    expect(res.total).toBe(1);
    expect(res.items[0].matchTier).toBe(2);
    expect(res.items[0].missingCriteria).toEqual(['department']);
    expect(res.tierCounts).toEqual({ 1: 0, 2: 1, 3: 0 });
  });

  it('unknown amount with both minAmount and maxAmount appears in tier 2 with missingCriteria [amount]', async () => {
    const opp = makeOpp({
      id: asOpportunityId('unk-amt-1'),
      amountKnown: false,
      amount: { amount: 0, currency: 'COP' },
    });
    await repo.save(opp);

    const res = await repo.findPaged({
      amountMin: 10_000_000,
      amountMax: 50_000_000,
    });
    expect(res.total).toBe(1);
    expect(res.items[0].matchTier).toBe(2);
    expect(res.items[0].missingCriteria).toEqual(['amount']);
    expect(res.tierCounts).toEqual({ 1: 0, 2: 1, 3: 0 });
  });

  it('amount outside the range is excluded by default and present with includeMismatches', async () => {
    const opp = makeOpp({
      id: asOpportunityId('mismatch-amt-1'),
      amount: { amount: 150_000_000, currency: 'COP' },
      amountKnown: true,
    });
    await repo.save(opp);

    // Default: includeMismatches = false
    const resExcluded = await repo.findPaged({
      amountMin: 10_000_000,
      amountMax: 50_000_000,
    });
    expect(resExcluded.total).toBe(0);
    expect(resExcluded.items).toHaveLength(0);
    expect(resExcluded.tierCounts).toEqual({ 1: 0, 2: 0, 3: 0 });

    // With includeMismatches = true
    const resIncluded = await repo.findPaged({
      amountMin: 10_000_000,
      amountMax: 50_000_000,
      includeMismatches: true,
    });
    expect(resIncluded.total).toBe(1);
    expect(resIncluded.items).toHaveLength(1);
    expect(resIncluded.items[0].matchTier).toBe(3);
    expect(resIncluded.tierCounts).toEqual({ 1: 0, 2: 0, 3: 1 });
  });

  it('Unknown status within 30 days appears as unconfirmed', async () => {
    const opp = makeOpp({
      id: asOpportunityId('unk-status-1'),
      status: 'Unknown',
      publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      closingDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    await repo.save(opp);

    const res = await repo.findPaged({});
    expect(res.total).toBe(1);
    expect(res.items[0].id).toBe('unk-status-1');
    expect(res.items[0].statusConfidence).toBe('unconfirmed');
  });

  it('tierCounts are correct across pages', async () => {
    const opps: Opportunity[] = [
      // 3 in tier 1
      makeOpp({
        id: asOpportunityId('t1-1'),
        amount: { amount: 20_000_000, currency: 'COP' },
        publishedAt: new Date('2026-10-03'),
      }),
      makeOpp({
        id: asOpportunityId('t1-2'),
        amount: { amount: 30_000_000, currency: 'COP' },
        publishedAt: new Date('2026-10-02'),
      }),
      makeOpp({
        id: asOpportunityId('t1-3'),
        amount: { amount: 40_000_000, currency: 'COP' },
        publishedAt: new Date('2026-10-01'),
      }),
      // 2 in tier 2
      makeOpp({
        id: asOpportunityId('t2-1'),
        amountKnown: false,
        publishedAt: new Date('2026-10-05'),
      }),
      makeOpp({
        id: asOpportunityId('t2-2'),
        amountKnown: false,
        publishedAt: new Date('2026-10-04'),
      }),
    ];
    await repo.saveMany(opps);

    const filters = {
      amountMin: 10_000_000,
      amountMax: 50_000_000,
      pageSize: 2,
    };

    const page1 = await repo.findPaged({ ...filters, page: 1 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items.every((it) => it.matchTier === 1)).toBe(true);
    expect(page1.tierCounts).toEqual({ 1: 3, 2: 2, 3: 0 });

    const page2 = await repo.findPaged({ ...filters, page: 2 });
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0].matchTier).toBe(1);
    expect(page2.items[1].matchTier).toBe(2);
    expect(page2.tierCounts).toEqual({ 1: 3, 2: 2, 3: 0 });

    const page3 = await repo.findPaged({ ...filters, page: 3 });
    expect(page3.items).toHaveLength(1);
    expect(page3.items[0].matchTier).toBe(2);
    expect(page3.tierCounts).toEqual({ 1: 3, 2: 2, 3: 0 });
  });

  it('Step 7: The SQL version and the TypeScript evaluator agree across 30 sample rows', async () => {
    const sampleRows: Opportunity[] = [];
    const departments = [
      'Bogotá D.C.',
      'Antioquia',
      'Santander',
      'Distrito Capital de Bogotá',
      null,
    ];
    const categories = [
      '81111500',
      'V1.80111600',
      '43230000',
      '72141000',
      null,
      'UNSPECIFIED',
    ];
    const amounts = [30_000_000, 100_000_000, 300_000_000, 800_000_000, 0];
    const closingOffsetsDays = [5, 20, 60, -10, null];

    for (let i = 0; i < 30; i++) {
      const dept = departments[i % departments.length];
      const cat = categories[i % categories.length];
      const amt = amounts[i % amounts.length];
      const closingOffset = closingOffsetsDays[i % closingOffsetsDays.length];
      const isKnown = amt > 0 && i % 4 !== 0;

      sampleRows.push(
        makeOpp({
          id: asOpportunityId(`sample-${i}`),
          title: `Sample Opportunity ${i}`,
          location: {
            city: dept ? 'Ciudad' : null,
            department: dept,
            departmentRaw: dept,
          },
          categoryCode: cat,
          amount: { amount: isKnown ? amt : 0, currency: 'COP' },
          amountKnown: isKnown,
          // Keep closing date future or null so hard exclusions keep them
          closingDate:
            closingOffset !== null
              ? new Date(
                  Date.now() + Math.max(1, closingOffset) * 24 * 60 * 60 * 1000,
                )
              : null,
          status: 'Published',
          isCompetitive: true,
        }),
      );
    }

    await repo.saveMany(sampleRows);

    const testCriteriaList: Array<{
      name: string;
      criteria: Criteria;
      filterProps: any;
    }> = [
      {
        name: 'Amount min and max',
        criteria: { amountMin: 50_000_000, amountMax: 200_000_000 },
        filterProps: { amountMin: 50_000_000, amountMax: 200_000_000 },
      },
      {
        name: 'Department filter (Bogotá D.C.)',
        criteria: { departments: ['Bogotá D.C.'] },
        filterProps: { department: 'Bogotá D.C.' },
      },
      {
        name: 'Category prefix filter (8111)',
        criteria: { categoryPrefixes: ['8111'] },
        filterProps: { categoryPrefix: '8111' },
      },
      {
        name: 'Combined criteria (amount + department + category + closing)',
        criteria: {
          amountMin: 20_000_000,
          amountMax: 400_000_000,
          departments: ['Bogotá D.C.', 'Antioquia'],
          categoryPrefixes: ['8111', '8011'],
          closingAfter: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        },
        filterProps: {
          amountMin: 20_000_000,
          amountMax: 400_000_000,
          departments: ['Bogotá D.C.', 'Antioquia'],
          categoryPrefixes: ['8111', '8011'],
          closingAfter: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        },
      },
    ];

    for (const testCase of testCriteriaList) {
      const sqlResult = await repo.findPaged({
        ...testCase.filterProps,
        includeMismatches: true,
        pageSize: 50,
      });

      const sqlMap = new Map(sqlResult.items.map((it) => [it.id, it]));

      for (const sample of sampleRows) {
        const sqlItem = sqlMap.get(sample.id);
        expect(sqlItem).toBeDefined();

        const tsEvaluation = evaluateCriteria(sample, testCase.criteria);

        // Compare tier
        expect(sqlItem!.matchTier).toBe(tsEvaluation.tier);

        // Compare missing criteria
        expect([...(sqlItem!.missingCriteria ?? [])].sort()).toEqual(
          [...tsEvaluation.missing].sort(),
        );
      }
    }
  });
});
