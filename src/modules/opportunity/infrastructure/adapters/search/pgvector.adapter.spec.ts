import { Pool } from 'pg';
import {
  PgVectorAdapter,
  PGVECTOR_DIMENSIONS,
  DEFAULT_TABLE_NAME,
  reciprocalRankFusion,
  buildProfileOrTsQuery,
} from './pgvector.adapter';
import { Opportunity } from '../../../domain/entities/opportunity.entity';
import { asOpportunityId } from '../../../../shared/domain/typed-id';
import { HashEmbedder } from '../../../../shared/testing/hash-embedder';
import { PostgresOpportunityRepository } from '../persistence/postgres-opportunity.repository';
import { requireTestDatabaseUrl } from '../../../../shared/testing/test-database-url';
import { migrateTestDatabase } from '../../../../shared/testing/migrate-test-database';

describe('reciprocalRankFusion (Pure Domain Unit Tests)', () => {
  it('Example 1: fuses two 2-item lists where one item appears in both lists at different ranks (k=60)', () => {
    // List 1: A (rank 0 -> 1/61), B (rank 1 -> 1/62)
    // List 2: B (rank 0 -> 1/61), C (rank 1 -> 1/62)
    // Expected scores:
    //   B = 1/62 + 1/61 = 123 / 3782 ≈ 0.0325224749
    //   A = 1/61        =  62 / 3782 ≈ 0.0163934426
    //   C = 1/62        =  61 / 3782 ≈ 0.0161290323
    const list1 = [{ id: 'A' }, { id: 'B' }];
    const list2 = [{ id: 'B' }, { id: 'C' }];

    const fused = reciprocalRankFusion([list1, list2], 60);

    expect(fused.map((x) => x.id)).toEqual(['B', 'A', 'C']);
    expect(fused[0].fusedScore).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(fused[1].fusedScore).toBeCloseTo(1 / 61, 10);
    expect(fused[2].fusedScore).toBeCloseTo(1 / 62, 10);
  });

  it('Example 2: fuses three lists with k=10 and respects the limit parameter', () => {
    // With k = 10:
    // List 1: X (rank 0 -> 1/11), Y (rank 1 -> 1/12), Z (rank 2 -> 1/13)
    // List 2: Z (rank 0 -> 1/11), X (rank 1 -> 1/12)
    // List 3: Z (rank 0 -> 1/11), W (rank 1 -> 1/12)
    // Expected scores:
    //   Z = 1/13 + 1/11 + 1/11 = 0.0769230769 + 0.1818181818 = 0.2587412587
    //   X = 1/11 + 1/12        = 0.0909090909 + 0.0833333333 = 0.1742424242
    //   Y = 1/12               = 0.0833333333
    //   W = 1/12               = 0.0833333333
    const list1 = [{ id: 'X' }, { id: 'Y' }, { id: 'Z' }];
    const list2 = [{ id: 'Z' }, { id: 'X' }];
    const list3 = [{ id: 'Z' }, { id: 'W' }];

    const fusedTop2 = reciprocalRankFusion([list1, list2, list3], 10, 2);

    expect(fusedTop2).toHaveLength(2);
    expect(fusedTop2[0].id).toBe('Z');
    expect(fusedTop2[0].fusedScore).toBeCloseTo(1 / 13 + 2 / 11, 10);
    expect(fusedTop2[1].id).toBe('X');
    expect(fusedTop2[1].fusedScore).toBeCloseTo(1 / 11 + 1 / 12, 10);
  });

  it('Example 3: handles disjoint lists and deduplicates repeated ids within the same list (k=60)', () => {
    // List 1 has duplicate 'M' at rank 0 and rank 1; only rank 0 (1/61) counts in List 1, plus 'N' at rank 2 (1/63)
    // List 2 has 'P' at rank 0 (1/61) and 'N' at rank 1 (1/62)
    // Expected scores:
    //   N = 1/63 + 1/62 = 125 / 3906 ≈ 0.0320020481
    //   M = 1/61        ≈ 0.0163934426
    //   P = 1/61        ≈ 0.0163934426
    const list1 = [{ id: 'M' }, { id: 'M' }, { id: 'N' }];
    const list2 = [{ id: 'P' }, { id: 'N' }];

    const fused = reciprocalRankFusion([list1, list2], 60);

    expect(fused[0].id).toBe('N');
    expect(fused[0].fusedScore).toBeCloseTo(1 / 63 + 1 / 62, 10);
    expect(fused[1].fusedScore).toBeCloseTo(1 / 61, 10);
    expect(fused[2].fusedScore).toBeCloseTo(1 / 61, 10);
  });

  it('buildProfileOrTsQuery extracts up to 20 sanitized alphanumeric terms joined by OR', () => {
    const query = buildProfileOrTsQuery(
      'Tecnología de la información. Desarrollo web, ciberseguridad & pentesting! 2026',
    );
    expect(query).toBe('Tecnología | información | Desarrollo | web | ciberseguridad | pentesting | 2026');
  });
});

describe('PgVectorAdapter', () => {
  let mockPool: jest.Mocked<Pool>;
  let embedder: HashEmbedder;

  const createValidVector = (fillValue: number = 0.01): number[] =>
    new Array(PGVECTOR_DIMENSIONS).fill(fillValue);

  beforeEach(() => {
    mockPool = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    } as unknown as jest.Mocked<Pool>;

    embedder = new HashEmbedder('nomic-embed-text');
  });

  describe('initSchema', () => {
    it('executes DDL with vector extension, table definition, embedding_model and HNSW index', async () => {
      const adapter = new PgVectorAdapter({ pool: mockPool });
      await adapter.initSchema();

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const queryText = (mockPool.query as jest.Mock).mock.calls[0][0];
      expect(queryText).toContain('CREATE EXTENSION IF NOT EXISTS vector');
      expect(queryText).toContain(`CREATE TABLE IF NOT EXISTS ${DEFAULT_TABLE_NAME}`);
      expect(queryText).toContain('embedding_model TEXT NOT NULL');
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

    it('generates embedding via buildIndexText (excluding LLM summary) and upserts with embedding_model and text_hash', async () => {
      const customEmbedder = new HashEmbedder('custom-embed-v1');
      const adapter = new PgVectorAdapter({
        pool: mockPool,
        embedder: customEmbedder,
      });

      await adapter.indexOpportunity(testOpportunity);

      expect(customEmbedder.calls).toBe(1);
      const embeddedText = customEmbedder.embeddedBatches[0][0];
      expect(embeddedText).toBe(
        'Mantenimiento de infraestructura hospitalaria. Obras de remodelacion y mantenimiento hospitalario. Entidad: Hospital Central. Tipo: Obra.',
      );
      expect(embeddedText).not.toContain('salas de cirugia'); // LLM summary excluded
      expect(mockPool.query).toHaveBeenCalledTimes(1);

      const [sql, params] = (mockPool.query as jest.Mock).mock.calls[0];
      expect(sql).toContain(`INSERT INTO ${DEFAULT_TABLE_NAME}`);
      expect(sql).toContain('embedding_model, text_hash');
      expect(sql).toContain('ON CONFLICT (opportunity_id) DO UPDATE SET');
      expect(params[0]).toBe('opp-101');
      expect(params[1]).toBe('V1.72121400');
      expect(params[2]).toBe('Cundinamarca');
      expect(params[3]).toBe('Obra');
      expect(params[4]).toBe(500_000_000);
      expect(params[5]).toBe('custom-embed-v1');
      expect(typeof params[6]).toBe('string');
      expect(params[6]).toHaveLength(64);
      expect(params[7]).toContain('[');
      expect(params[7].split(',')).toHaveLength(PGVECTOR_DIMENSIONS);
    });

    it('throws error when EmbedderPort is missing and indexOpportunity is called', async () => {
      const adapter = new PgVectorAdapter({ pool: mockPool });

      await expect(adapter.indexOpportunity(testOpportunity)).rejects.toThrow(
        'PgVectorAdapter: EmbedderPort is required',
      );
    });

    it('throws error when vector does not have exactly 768 dimensions', async () => {
      const adapter = new PgVectorAdapter({ pool: mockPool });
      const invalidVector = new Array(512).fill(0.1);

      await expect(
        adapter.indexVector(asOpportunityId('opp-bad'), invalidVector),
      ).rejects.toThrow(
        'PgVectorAdapter: vector dimension mismatch. Expected 768 dimensions, received 512.',
      );
    });
  });

  describe('semanticSearch and similarities', () => {
    it('rejects queryVector with incorrect dimensions', async () => {
      const adapter = new PgVectorAdapter({ pool: mockPool });
      const badVector = [0.1, 0.2];

      await expect(adapter.semanticSearch(badVector)).rejects.toThrow(
        'PgVectorAdapter: query vector dimension mismatch. Expected 768 dimensions, received 2.',
      );
    });

    it('performs semantic search filtering by embedding_model and ordering by cosine distance (<=>)', async () => {
      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [
          { opportunity_id: 'opp-1' },
          { opportunity_id: 'opp-2' },
        ],
      });

      const adapter = new PgVectorAdapter({ pool: mockPool, embedder });
      const queryVector = createValidVector();

      const results = await adapter.semanticSearch(queryVector, {}, 10);

      expect(results).toEqual(['opp-1', 'opp-2']);
      expect(mockPool.query).toHaveBeenCalledTimes(1);

      const [sql, params] = (mockPool.query as jest.Mock).mock.calls[0];
      expect(sql).toContain('WHERE embedding_model = $2');
      expect(sql).toContain('ORDER BY embedding <=> $1::vector ASC');
      expect(sql).toContain('LIMIT $3');
      expect(params[0]).toContain('[');
      expect(params[1]).toBe('nomic-embed-text');
      expect(params[2]).toBe(10);
    });

    it('applies structured filters alongside embedding_model and vector cosine search', async () => {
      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [{ opportunity_id: 'opp-filtered' }],
      });

      const adapter = new PgVectorAdapter({ pool: mockPool, embedder });
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
      expect(sql).toContain('embedding_model = $2');
      expect(sql).toContain('category_code LIKE $3');
      expect(sql).toContain('department = $4');
      expect(sql).toContain('contract_type = $5');
      expect(sql).toContain('amount >= $6');
      expect(sql).toContain('amount <= $7');
      expect(sql).toContain('ORDER BY embedding <=> $1::vector ASC');

      expect(params[1]).toBe('nomic-embed-text');
      expect(params[2]).toBe('V1.72%');
      expect(params[3]).toBe('Antioquia');
      expect(params[4]).toBe('Servicios');
      expect(params[5]).toBe(10_000_000);
      expect(params[6]).toBe(50_000_000);
    });

    it('similarities() queries cosine similarity in one SQL call filtered by embedding_model', async () => {
      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [
          { opportunity_id: 'opp-1', cosine: 0.72 },
          { opportunity_id: 'opp-2', cosine: 0.51 },
        ],
      });

      const adapter = new PgVectorAdapter({ pool: mockPool, embedder });
      const queryVector = createValidVector();
      const ids = [asOpportunityId('opp-1'), asOpportunityId('opp-2')];

      const map = await adapter.similarities(queryVector, ids);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = (mockPool.query as jest.Mock).mock.calls[0];
      expect(sql).toContain('1 - (embedding <=> $1::vector) AS cosine');
      expect(sql).toContain('opportunity_id = ANY($2::text[])');
      expect(sql).toContain('AND embedding_model = $3');
      expect(params[1]).toEqual(ids);
      expect(params[2]).toBe('nomic-embed-text');
      expect(map.get(asOpportunityId('opp-1'))).toBeCloseTo(0.72);
      expect(map.get(asOpportunityId('opp-2'))).toBeCloseTo(0.51);
    });
  });

  describe('retrieveCandidates (Real Postgres Integration with HashEmbedder)', () => {
    const TEST_DATABASE_URL = requireTestDatabaseUrl();
    let pool: Pool;
    let oppRepo: PostgresOpportunityRepository;
    let hashEmbedder: HashEmbedder;
    let pgVector: PgVectorAdapter;

    const futureClosingDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const makeOpportunity = (
      id: string,
      title: string,
      description: string,
      overrides: Partial<Opportunity> = {},
    ): Opportunity => ({
      id: asOpportunityId(id),
      title,
      description,
      contractingEntity: { name: 'Ministerio TIC', taxId: '800100200' },
      location: { city: 'Bogotá', department: 'Bogotá D.C.' },
      amount: { amount: 120_000_000, currency: 'COP' },
      amountKnown: true,
      contractType: 'Servicios',
      procurementModality: 'Concurso de méritos',
      isCompetitive: true,
      categoryCode: 'V1.43230000',
      publishedAt: new Date('2026-03-10T00:00:00.000Z'),
      lastPublishedAt: new Date('2026-03-10T00:00:00.000Z'),
      closingDate: futureClosingDate,
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
    });

    beforeAll(async () => {
      pool = new Pool({ connectionString: TEST_DATABASE_URL });
      await migrateTestDatabase(pool);
      oppRepo = new PostgresOpportunityRepository(pool);
      hashEmbedder = new HashEmbedder('nomic-embed-text');
      pgVector = new PgVectorAdapter({
        pool,
        embedder: hashEmbedder,
      });
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query('DELETE FROM opportunity_embeddings;');
      await pool.query('DELETE FROM opportunities;');
    });

    it('retrieves keyword-only via full-text, meaning-only via vector, ranks the one found by both first, and never returns direct contracting', async () => {
      // Query has keyword "pentesting" and meaning vector derived from semanticSeedText
      const semanticSeedText = 'proteccion criptografica endpoints nube';
      const [queryVector] = await hashEmbedder.embed([semanticSeedText]);

      // 1. Found by BOTH: contains keyword "pentesting" in title/description AND has vector matching queryVector
      const oppBoth = makeOpportunity(
        'opp-both',
        'Servicio especializado de pentesting y auditoría ética',
        'Evaluación de vulnerabilidades mediante pentesting en aplicaciones críticas',
      );

      // 2. Found ONLY by keywords (full-text): contains "pentesting", no embedding row yet
      const oppKeywordOnly = makeOpportunity(
        'opp-keyword-only',
        'Pruebas de pentesting sobre portales institucionales',
        'Ejecución de pentesting de caja negra y caja blanca',
      );

      // 3. Found ONLY by vector (meaning): does NOT contain "pentesting", but embedded with semanticSeedText vector
      const oppVectorOnly = makeOpportunity(
        'opp-vector-only',
        'Blindaje informático de infraestructura crítica',
        'Aseguramiento de servidores y monitoreo continuo',
      );

      // 4. Direct contracting (isCompetitive = false): matches both keyword and vector, must NEVER be returned
      const oppDirect = makeOpportunity(
        'opp-direct',
        'Consultoría directa de pentesting y seguridad',
        'Servicio de pentesting por contratación directa',
        {
          procurementModality: 'Contratación directa',
          isCompetitive: false,
        },
      );

      await oppRepo.saveMany([oppBoth, oppKeywordOnly, oppVectorOnly, oppDirect]);

      // Index vectors for oppBoth, oppVectorOnly, and oppDirect (oppKeywordOnly has no vector)
      await pgVector.indexVector(oppBoth.id, queryVector, {
        embeddingModel: hashEmbedder.model,
      });
      await pgVector.indexVector(oppVectorOnly.id, queryVector, {
        embeddingModel: hashEmbedder.model,
      });
      await pgVector.indexVector(oppDirect.id, queryVector, {
        embeddingModel: hashEmbedder.model,
      });

      const result = await pgVector.retrieveCandidates(
        {
          text: 'pentesting',
          vector: queryVector,
          mode: 'profile',
        },
        {
          onlyCompetitive: true,
          actionable: true,
        },
        10,
      );

      expect(result.degraded).toBe(false);
      expect(result.level).toBe('hybrid');

      const returnedIds = result.items.map((item) => item.id);

      // Direct contracting is never returned
      expect(returnedIds).not.toContain(oppDirect.id);

      // All three competitive candidates are returned
      expect(returnedIds).toContain(oppBoth.id);
      expect(returnedIds).toContain(oppKeywordOnly.id);
      expect(returnedIds).toContain(oppVectorOnly.id);

      // The one found by both ranks first
      expect(result.items[0].id).toBe(oppBoth.id);
      expect(result.items[0].cosine).not.toBeNull();
      expect(result.items[0].textRank).not.toBeNull();

      // Keyword-only has textRank != null and cosine == null
      const keywordItem = result.items.find((i) => i.id === oppKeywordOnly.id)!;
      expect(keywordItem.textRank).not.toBeNull();
      expect(keywordItem.cosine).toBeNull();

      // Vector-only has cosine != null and textRank == null
      const vectorItem = result.items.find((i) => i.id === oppVectorOnly.id)!;
      expect(vectorItem.cosine).not.toBeNull();
      expect(vectorItem.textRank).toBeNull();
    });

    it('degrades gracefully with degraded=true and level=fulltext when vector query fails', async () => {
      const oppKeyword = makeOpportunity(
        'opp-degraded-ft',
        'Adquisición de licencias de ciberseguridad',
        'Suministro de software de ciberseguridad empresarial',
      );
      await oppRepo.save(oppKeyword);

      // Pass an invalid vector (wrong dimension) so the vector branch rejects while full-text succeeds
      const result = await pgVector.retrieveCandidates(
        {
          text: 'ciberseguridad',
          vector: [0.1, 0.2], // invalid dimension -> vector query fails
          mode: 'user',
        },
        {
          onlyCompetitive: true,
          actionable: true,
        },
        10,
      );

      expect(result.degraded).toBe(true);
      expect(result.level).toBe('fulltext');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(oppKeyword.id);
      expect(result.items[0].cosine).toBeNull();
      expect(result.items[0].textRank).not.toBeNull();
    });
  });
});
