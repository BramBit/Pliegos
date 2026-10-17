import { LoggerService } from '@nestjs/common';
import { Pool } from 'pg';
import {
  AnalyzeOpportunityJob,
  computeAnalysisContentHash,
  IJobLike,
} from './analyze-opportunity.job';
import {
  BullMQAnalysisQueueAdapter,
  IQueueLike,
  ANALYZE_OPPORTUNITY_JOB_NAME,
  AnalyzeOpportunityJobPayload,
} from '../adapters/queue/bullmq-analysis-queue.adapter';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { TextGeneratorPort } from '../../../recommendation/domain/ports/ai-provider.port';
import { SearchIndexPort } from '../../domain/ports/search-index.port';
import { Opportunity } from '../../domain/entities/opportunity.entity';
import { asOpportunityId } from '../../../shared/domain/typed-id';
import {
  OpportunityLockBusyError,
  PostgresOpportunityRepository,
} from '../adapters/persistence/postgres-opportunity.repository';
import { PgVectorAdapter } from '../adapters/search/pgvector.adapter';
import { requireTestDatabaseUrl } from '../../../shared/testing/test-database-url';
import { migrateTestDatabase } from '../../../shared/testing/migrate-test-database';
import { HashEmbedder } from '../../../shared/testing/hash-embedder';

describe('BullMQ Analysis Queue & Job Processing', () => {
  let fakeLogger: LoggerService & { logs: string[]; warnings: string[] };

  beforeEach(() => {
    fakeLogger = {
      log: jest.fn((msg: string) => fakeLogger.logs.push(msg)),
      error: jest.fn(),
      warn: jest.fn((msg: string) => fakeLogger.warnings.push(msg)),
      debug: jest.fn(),
      verbose: jest.fn(),
      logs: [],
      warnings: [],
    };
  });

  describe('BullMQAnalysisQueueAdapter', () => {
    it('enqueues analysis job with correct job name, payload, and retry policy', async () => {
      const addedJobs: Array<{ name: string; data: any; opts?: any }> = [];
      const mockQueue: IQueueLike = {
        add: jest.fn(async (name, data, opts) => {
          addedJobs.push({ name, data, opts });
          return { id: 'job-1' };
        }),
      };

      const adapter = new BullMQAnalysisQueueAdapter(mockQueue, fakeLogger);
      const opportunityId = asOpportunityId('opp-enqueue-1');

      await adapter.enqueueAnalysis(opportunityId);

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(addedJobs).toHaveLength(1);
      expect(addedJobs[0].name).toBe(ANALYZE_OPPORTUNITY_JOB_NAME);
      expect(addedJobs[0].data).toEqual({ opportunityId });
      expect(addedJobs[0].opts).toEqual(
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        }),
      );
      expect(fakeLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Enqueued analysis job for Opportunity opp-enqueue-1'),
      );
    });
  });

  describe('AnalyzeOpportunityJob (In-Memory Unit Tests)', () => {
    let storedOpportunity: Opportunity | null;
    let mockOppRepo: jest.Mocked<OpportunityRepositoryPort>;
    let mockTextGenerator: jest.Mocked<TextGeneratorPort>;
    let embedder: HashEmbedder;
    let mockSearchIndex: jest.Mocked<SearchIndexPort>;
    let processor: AnalyzeOpportunityJob;

    const sampleOpportunity: Opportunity = {
      id: asOpportunityId('opp-job-1'),
      title: 'Mantenimiento preventivo de vias urbanas',
      description: 'Rehabilitacion vial en comunas urbanas',
      contractingEntity: {
        name: 'Secretaria de Infraestructura',
        taxId: '800100200',
      },
      location: {
        city: 'Cali',
        department: 'Valle del Cauca',
      },
      amount: {
        amount: 250_000_000,
        currency: 'COP',
      },
      amountKnown: true,
      contractType: 'Obra publica',
      procurementModality: 'Licitacion publica',
      isCompetitive: true,
      categoryCode: '72121400',
      publishedAt: new Date('2026-03-01T00:00:00.000Z'),
      lastPublishedAt: new Date('2026-03-01T00:00:00.000Z'),
      closingDate: new Date('2026-03-30T00:00:00.000Z'),
      isOpenForSubmission: true,
      status: 'Published',
      source: {
        sourceName: 'SECOP',
        externalId: 'CO1.REQ.9911',
        humanReference: 'CALI-OBRAS-2026',
        originalUrl: 'https://community.secop.gov.co/9911',
      },
      analysis: null,
      changeHistory: [],
    };

    beforeEach(() => {
      storedOpportunity = { ...sampleOpportunity };

      mockOppRepo = {
        save: jest.fn().mockResolvedValue(undefined),
        saveMany: jest.fn().mockResolvedValue(undefined),
        saveAnalysis: jest.fn(async (_id, analysis) => {
          if (storedOpportunity) {
            storedOpportunity = { ...storedOpportunity, analysis };
          }
        }),
        withAnalysisLock: jest.fn(async (_id, work) => {
          await work();
        }),
        findById: jest.fn(async (_id) => storedOpportunity),
        findByExternalId: jest.fn().mockResolvedValue(null),
        findByExternalIds: jest.fn().mockResolvedValue([]),
        findByFilters: jest.fn().mockResolvedValue([]),
      };

      mockTextGenerator = {
        summarize: jest.fn().mockResolvedValue('Resumen sintetizado por IA de las obras viales.'),
      };

      embedder = new HashEmbedder('nomic-embed-text');

      mockSearchIndex = {
        indexOpportunity: jest.fn(async (opp) => {
          await embedder.embed([opp.title]);
        }),
        semanticSearch: jest.fn().mockResolvedValue([]),
        similarities: jest.fn().mockResolvedValue(new Map()),
      };

      processor = new AnalyzeOpportunityJob(
        mockOppRepo,
        mockTextGenerator,
        mockSearchIndex,
        fakeLogger,
        embedder,
      );
    });

    it('processes job: generates summary, requirements, contentHash, indexes in pgvector, and persists via saveAnalysis', async () => {
      const job: IJobLike<AnalyzeOpportunityJobPayload> = {
        id: 'job-test-1',
        data: { opportunityId: sampleOpportunity.id },
      };

      await processor.process(job);

      expect(mockOppRepo.withAnalysisLock).toHaveBeenCalledTimes(1);
      expect(mockOppRepo.findById).toHaveBeenCalledWith(sampleOpportunity.id);
      expect(mockTextGenerator.summarize).toHaveBeenCalledWith(
        expect.stringContaining('Mantenimiento preventivo de vias urbanas'),
      );
      expect(mockSearchIndex.indexOpportunity).toHaveBeenCalledTimes(1);

      const expectedHash = computeAnalysisContentHash(sampleOpportunity, 'nomic-embed-text');
      expect(mockOppRepo.saveAnalysis).toHaveBeenCalledWith(
        sampleOpportunity.id,
        expect.objectContaining({
          summary: 'Resumen sintetizado por IA de las obras viales.',
          contentHash: expectedHash,
        }),
      );
      expect(mockOppRepo.save).not.toHaveBeenCalled();
    });

    it('analyzing the same opportunity twice makes zero Ollama calls the second time', async () => {
      const job: IJobLike<AnalyzeOpportunityJobPayload> = {
        id: 'job-test-idempotent',
        data: { opportunityId: sampleOpportunity.id },
      };

      // First run performs summarize + embed
      await processor.process(job);
      expect(mockTextGenerator.summarize).toHaveBeenCalledTimes(1);
      expect(embedder.calls).toBe(1);
      expect(mockOppRepo.saveAnalysis).toHaveBeenCalledTimes(1);

      mockTextGenerator.summarize.mockClear();
      embedder.calls = 0;
      mockOppRepo.saveAnalysis.mockClear();

      // Second run over the same opportunity (even if closingDate changed in the meantime)
      storedOpportunity = {
        ...storedOpportunity!,
        closingDate: new Date('2026-04-20T00:00:00.000Z'),
      };

      await processor.process(job);

      expect(mockTextGenerator.summarize).not.toHaveBeenCalled();
      expect(embedder.calls).toBe(0);
      expect(mockOppRepo.saveAnalysis).not.toHaveBeenCalled();
      expect(fakeLogger.logs).toContainEqual(
        expect.stringContaining('contentHash'),
      );
    });

    it('skips processing and logs warning if opportunity is not found', async () => {
      storedOpportunity = null;

      const job: IJobLike<AnalyzeOpportunityJobPayload> = {
        id: 'job-missing',
        data: { opportunityId: asOpportunityId('opp-not-found') },
      };

      await processor.process(job);

      expect(mockOppRepo.findById).toHaveBeenCalledWith('opp-not-found');
      expect(mockTextGenerator.summarize).not.toHaveBeenCalled();
      expect(mockSearchIndex.indexOpportunity).not.toHaveBeenCalled();
      expect(mockOppRepo.saveAnalysis).not.toHaveBeenCalled();
      expect(fakeLogger.warnings).toContainEqual(
        expect.stringContaining('Opportunity opp-not-found not found in repository. Skipping analysis.'),
      );
    });
  });

  describe('AnalyzeOpportunityJob (Real Test Database Integration)', () => {
    const TEST_DATABASE_URL = requireTestDatabaseUrl();
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
      await pool.query('DELETE FROM opportunity_embeddings;');
      await pool.query('DELETE FROM opportunities;');
    });

    it('does not lose concurrent closing_date update while the analysis job runs, and enforces pg_try_advisory_lock', async () => {
      const oppId = asOpportunityId('opp-race-test-1');
      const initialClosingDate = new Date('2026-03-30T17:00:00.000Z');
      const concurrentClosingDate = new Date('2026-04-25T17:00:00.000Z');

      const initialOpportunity: Opportunity = {
        id: oppId,
        title: 'Construcción de puente vehicular',
        description: 'Obras estructurales de puente sobre río Magdalena',
        contractingEntity: {
          name: 'INVIAS',
          taxId: '800215807',
        },
        location: {
          city: 'Honda',
          department: 'Tolima',
        },
        amount: {
          amount: 1_200_000_000,
          currency: 'COP',
        },
        amountKnown: true,
        contractType: 'Obra',
        procurementModality: 'Licitación pública',
        isCompetitive: true,
        categoryCode: '72141100',
        publishedAt: new Date('2026-03-01T00:00:00.000Z'),
        lastPublishedAt: new Date('2026-03-01T00:00:00.000Z'),
        closingDate: initialClosingDate,
        isOpenForSubmission: true,
        status: 'Published',
        source: {
          sourceName: 'SECOP',
          externalId: 'CO1.REQ.RACE1',
          humanReference: 'INV-PUENTE-01',
          originalUrl: 'https://community.secop.gov.co/race1',
        },
        analysis: null,
        changeHistory: [],
      };

      await repo.save(initialOpportunity);

      let concurrentLockAttemptError: unknown = null;
      const embedder = new HashEmbedder('nomic-embed-text');

      const pgVector = new PgVectorAdapter({
        pool,
        embedder,
        logger: fakeLogger,
      });

      const textGenerator: jest.Mocked<TextGeneratorPort> = {
        summarize: jest.fn(async (_text: string) => {
          // 1. While job 1 holds the advisory lock and has already loaded initialOpportunity,
          // update closing_date in the database concurrently (simulating a concurrent sync).
          await pool.query(
            'UPDATE opportunities SET closing_date = $2 WHERE id = $1',
            [oppId, concurrentClosingDate],
          );

          // 2. Also verify a second concurrent job for the same opportunity fails fast on the advisory lock.
          const secondJobProcessor = new AnalyzeOpportunityJob(
            repo,
            textGenerator,
            pgVector,
            fakeLogger,
            embedder,
          );
          try {
            await secondJobProcessor.process({ id: 'job-2', data: { opportunityId: oppId } });
          } catch (err) {
            concurrentLockAttemptError = err;
          }

          return 'Resumen del puente vehicular sobre el río Magdalena.';
        }),
      };

      const jobProcessor = new AnalyzeOpportunityJob(
        repo,
        textGenerator,
        pgVector,
        fakeLogger,
        embedder,
      );

      // First run: executes while closing_date is updated concurrently
      await jobProcessor.process({ id: 'job-1', data: { opportunityId: oppId } });

      // Concurrent lock attempt while job-1 was running threw OpportunityLockBusyError
      expect(concurrentLockAttemptError).toBeInstanceOf(OpportunityLockBusyError);

      // Verify closing_date update was NOT overwritten by the job!
      const afterFirstRun = await repo.findById(oppId);
      expect(afterFirstRun).not.toBeNull();
      expect(afterFirstRun?.closingDate).toEqual(concurrentClosingDate);
      expect(afterFirstRun?.analysis?.summary).toBe(
        'Resumen del puente vehicular sobre el río Magdalena.',
      );
      expect(afterFirstRun?.analysis?.contentHash).toBe(
        computeAnalysisContentHash(initialOpportunity, 'nomic-embed-text'),
      );

      // Verify embedding_model was written to opportunity_embeddings
      const embRow = await pool.query<{ embedding_model: string }>(
        'SELECT embedding_model FROM opportunity_embeddings WHERE opportunity_id = $1',
        [oppId],
      );
      expect(embRow.rows[0]?.embedding_model).toBe('nomic-embed-text');

      // Second run after lock is released: contentHash matches -> zero Ollama calls
      textGenerator.summarize.mockClear();
      embedder.calls = 0;

      await jobProcessor.process({ id: 'job-3', data: { opportunityId: oppId } });
      expect(textGenerator.summarize).not.toHaveBeenCalled();
      expect(embedder.calls).toBe(0);
    });
  });
});
