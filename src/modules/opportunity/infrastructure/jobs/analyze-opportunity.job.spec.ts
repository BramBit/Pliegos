import { LoggerService } from '@nestjs/common';
import {
  AnalyzeOpportunityJob,
  IJobLike,
} from './analyze-opportunity.job';
import {
  BullMQAnalysisQueueAdapter,
  IQueueLike,
  ANALYSIS_QUEUE_NAME,
  ANALYZE_OPPORTUNITY_JOB_NAME,
  AnalyzeOpportunityJobPayload,
} from '../adapters/queue/bullmq-analysis-queue.adapter';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { AIProviderPort } from '../../../recommendation/domain/ports/ai-provider.port';
import { SearchIndexPort } from '../../domain/ports/search-index.port';
import { Opportunity } from '../../domain/entities/opportunity.entity';
import { asOpportunityId } from '../../../shared/domain/typed-id';

describe('BullMQ Analysis Queue & Job Processing (In-Memory Setup)', () => {
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

  describe('AnalyzeOpportunityJob (Worker Processor)', () => {
    let mockOppRepo: jest.Mocked<OpportunityRepositoryPort>;
    let mockAiProvider: jest.Mocked<AIProviderPort>;
    let mockSearchIndex: jest.Mocked<SearchIndexPort>;
    let processor: AnalyzeOpportunityJob;

    const sampleOpportunity: Opportunity = {
      id: asOpportunityId('opp-job-1'),
      title: 'Mantenimiento preventivo de vias urbanas',
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
      contractType: 'Obra publica',
      procurementModality: 'Licitacion publica',
      categoryCode: 'V1.72121400',
      publishedAt: new Date('2026-03-01T00:00:00.000Z'),
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
      mockOppRepo = {
        save: jest.fn().mockResolvedValue(undefined),
        findById: jest.fn().mockResolvedValue(sampleOpportunity),
        findByExternalId: jest.fn().mockResolvedValue(null),
        findByFilters: jest.fn().mockResolvedValue([]),
      };

      mockAiProvider = {
        embed: jest.fn().mockResolvedValue(new Array(768).fill(0.01)),
        summarize: jest.fn().mockResolvedValue('Resumen sintetizado por IA de las obras viales.'),
        scoreSimilarity: jest.fn().mockResolvedValue(0.95),
      };

      mockSearchIndex = {
        indexOpportunity: jest.fn().mockResolvedValue(undefined),
        semanticSearch: jest.fn().mockResolvedValue([]),
      };

      processor = new AnalyzeOpportunityJob(
        mockOppRepo,
        mockAiProvider,
        mockSearchIndex,
        fakeLogger,
      );
    });

    it('processes job: generates summary, requirements, indexes in pgvector, and updates repository', async () => {
      const job: IJobLike<AnalyzeOpportunityJobPayload> = {
        id: 'job-test-1',
        data: { opportunityId: sampleOpportunity.id },
      };

      await processor.process(job);

      // 1. Retrieved opportunity from repo
      expect(mockOppRepo.findById).toHaveBeenCalledWith(sampleOpportunity.id);

      // 2. Called AI Provider to summarize
      expect(mockAiProvider.summarize).toHaveBeenCalledWith(
        expect.stringContaining('Mantenimiento preventivo de vias urbanas'),
      );

      // 3. Indexed in search index (pgvector)
      expect(mockSearchIndex.indexOpportunity).toHaveBeenCalledTimes(1);
      const indexedOpp: Opportunity = mockSearchIndex.indexOpportunity.mock.calls[0][0];
      expect(indexedOpp.analysis).not.toBeNull();
      expect(indexedOpp.analysis?.summary).toBe('Resumen sintetizado por IA de las obras viales.');
      expect(indexedOpp.analysis?.requirements).toHaveLength(3);
      expect(indexedOpp.analysis?.requirements[0].type).toBe('financial');
      expect(indexedOpp.analysis?.requirements[1].type).toBe('technical');
      expect(indexedOpp.analysis?.requirements[2].type).toBe('legal');
      expect(indexedOpp.analysis?.embeddingGeneratedAt).toBeInstanceOf(Date);

      // 4. Saved updated opportunity in repository
      expect(mockOppRepo.save).toHaveBeenCalledWith(indexedOpp);

      // 5. Logged success
      expect(fakeLogger.logs).toContainEqual(
        expect.stringContaining('Successfully completed analysis & indexing for Opportunity opp-job-1'),
      );
    });

    it('skips processing and logs warning if opportunity is not found', async () => {
      mockOppRepo.findById.mockResolvedValueOnce(null);

      const job: IJobLike<AnalyzeOpportunityJobPayload> = {
        id: 'job-missing',
        data: { opportunityId: asOpportunityId('opp-not-found') },
      };

      await processor.process(job);

      expect(mockOppRepo.findById).toHaveBeenCalledWith('opp-not-found');
      expect(mockAiProvider.summarize).not.toHaveBeenCalled();
      expect(mockSearchIndex.indexOpportunity).not.toHaveBeenCalled();
      expect(mockOppRepo.save).not.toHaveBeenCalled();
      expect(fakeLogger.warnings).toContainEqual(
        expect.stringContaining('Opportunity opp-not-found not found in repository. Skipping analysis.'),
      );
    });
  });
});
