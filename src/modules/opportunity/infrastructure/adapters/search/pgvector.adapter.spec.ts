import { Pool } from 'pg';
import {
  PgVectorAdapter,
  PGVECTOR_DIMENSIONS,
  DEFAULT_TABLE_NAME,
} from './pgvector.adapter';
import { Opportunity } from '../../../domain/entities/opportunity.entity';
import { AIProviderPort } from '../../../../recommendation/domain/ports/ai-provider.port';
import { asOpportunityId } from '../../../../shared/domain/typed-id';

describe('PgVectorAdapter', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockAiProvider: jest.Mocked<AIProviderPort>;

  const createValidVector = (fillValue: number = 0.01): number[] =>
    new Array(PGVECTOR_DIMENSIONS).fill(fillValue);

  beforeEach(() => {
    mockPool = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    } as unknown as jest.Mocked<Pool>;

    mockAiProvider = {
      embed: jest.fn().mockResolvedValue(createValidVector(0.05)),
      scoreSimilarity: jest.fn().mockResolvedValue(0.9),
      summarize: jest.fn().mockResolvedValue('Resumen test'),
    };
  });

  describe('initSchema', () => {
    it('executes DDL with vector extension, table definition and HNSW index', async () => {
      const adapter = new PgVectorAdapter({ pool: mockPool });
      await adapter.initSchema();

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const queryText = (mockPool.query as jest.Mock).mock.calls[0][0];
      expect(queryText).toContain('CREATE EXTENSION IF NOT EXISTS vector');
      expect(queryText).toContain(`CREATE TABLE IF NOT EXISTS ${DEFAULT_TABLE_NAME}`);
      expect(queryText).toContain(`vector(${PGVECTOR_DIMENSIONS})`);
      expect(queryText).toContain('USING hnsw (embedding vector_cosine_ops)');
    });
  });

  describe('indexOpportunity and indexVector', () => {
    const testOpportunity: Opportunity = {
      id: asOpportunityId('opp-101'),
      title: 'Mantenimiento de infraestructura hospitalaria',
      description: 'Obras de remodelacion y mantenimiento hospitalario',
      contractingEntity: { name: 'Hospital Central', taxId: '900000001' },
      location: { city: 'Bogota', department: 'Cundinamarca' },
      amount: { amount: 500_000_000, currency: 'COP' },
      amountKnown: true,
      contractType: 'Obra',
      procurementModality: 'Licitacion publica',
      isCompetitive: true,
      categoryCode: 'V1.72121400',
      publishedAt: new Date('2026-03-01'),
      lastPublishedAt: new Date('2026-03-01'),
      closingDate: new Date('2026-04-01'),
      isOpenForSubmission: true,
      status: 'Published',
      source: {
        sourceName: 'SECOP',
        externalId: 'CO1.REQ.101',
        humanReference: 'HOSP-2026',
        originalUrl: 'https://secop.gov.co/101',
      },
      analysis: {
        summary: 'Obras de remodelacion en salas de cirugia',
        requirements: [],
        embeddingGeneratedAt: null,
      },
      changeHistory: [],
    };

    it('generates embedding via AIProviderPort and upserts into Postgres', async () => {
      const adapter = new PgVectorAdapter({
        pool: mockPool,
        aiProvider: mockAiProvider,
      });

      await adapter.indexOpportunity(testOpportunity);

      expect(mockAiProvider.embed).toHaveBeenCalledWith(
        expect.stringContaining('Mantenimiento de infraestructura hospitalaria'),
      );
      expect(mockPool.query).toHaveBeenCalledTimes(1);

      const [sql, params] = (mockPool.query as jest.Mock).mock.calls[0];
      expect(sql).toContain(`INSERT INTO ${DEFAULT_TABLE_NAME}`);
      expect(sql).toContain('ON CONFLICT (opportunity_id) DO UPDATE SET');
      expect(params[0]).toBe('opp-101');
      expect(params[1]).toBe('V1.72121400');
      expect(params[2]).toBe('Cundinamarca');
      expect(params[3]).toBe('Obra');
      expect(params[4]).toBe(500_000_000);
      expect(params[5]).toContain('['); // vector formatted string
      expect(params[5].split(',')).toHaveLength(PGVECTOR_DIMENSIONS);
    });

    it('throws error when AIProviderPort is missing and indexOpportunity is called', async () => {
      const adapter = new PgVectorAdapter({ pool: mockPool });

      await expect(adapter.indexOpportunity(testOpportunity)).rejects.toThrow(
        'PgVectorAdapter: AIProviderPort is required',
      );
    });

    it('throws error when vector does not have exactly 768 dimensions', async () => {
      const adapter = new PgVectorAdapter({ pool: mockPool });
      const invalidVector = new Array(512).fill(0.1); // 512 != 768

      await expect(
        adapter.indexVector(asOpportunityId('opp-bad'), invalidVector),
      ).rejects.toThrow(
        'PgVectorAdapter: vector dimension mismatch. Expected 768 dimensions, received 512.',
      );
    });
  });

  describe('semanticSearch', () => {
    it('rejects queryVector with incorrect dimensions', async () => {
      const adapter = new PgVectorAdapter({ pool: mockPool });
      const badVector = [0.1, 0.2];

      await expect(adapter.semanticSearch(badVector)).rejects.toThrow(
        'PgVectorAdapter: query vector dimension mismatch. Expected 768 dimensions, received 2.',
      );
    });

    it('performs semantic search ordering by cosine distance (<=>) with limit', async () => {
      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [
          { opportunity_id: 'opp-1' },
          { opportunity_id: 'opp-2' },
        ],
      });

      const adapter = new PgVectorAdapter({ pool: mockPool });
      const queryVector = createValidVector();

      const results = await adapter.semanticSearch(queryVector, {}, 10);

      expect(results).toEqual(['opp-1', 'opp-2']);
      expect(mockPool.query).toHaveBeenCalledTimes(1);

      const [sql, params] = (mockPool.query as jest.Mock).mock.calls[0];
      expect(sql).toContain('ORDER BY embedding <=> $1::vector ASC');
      expect(sql).toContain('LIMIT $2');
      expect(params[0]).toContain('[');
      expect(params[1]).toBe(10);
    });

    it('applies structured filters alongside vector cosine search', async () => {
      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [{ opportunity_id: 'opp-filtered' }],
      });

      const adapter = new PgVectorAdapter({ pool: mockPool });
      const queryVector = createValidVector();

      const results = await adapter.semanticSearch(queryVector, {
        categoryCode: 'V1.72',
        department: 'Antioquia',
        contractType: 'Servicios',
        amountMin: 10_000_000,
        amountMax: 50_000_000,
      });

      expect(results).toEqual(['opp-filtered']);

      const [sql, params] = (mockPool.query as jest.Mock).mock.calls[0];
      expect(sql).toContain('category_code LIKE $2');
      expect(sql).toContain('department = $3');
      expect(sql).toContain('contract_type = $4');
      expect(sql).toContain('amount >= $5');
      expect(sql).toContain('amount <= $6');
      expect(sql).toContain('ORDER BY embedding <=> $1::vector ASC');

      expect(params[1]).toBe('V1.72%');
      expect(params[2]).toBe('Antioquia');
      expect(params[3]).toBe('Servicios');
      expect(params[4]).toBe(10_000_000);
      expect(params[5]).toBe(50_000_000);
    });
  });
});
