import { GetOpportunityByIdUseCase } from './get-opportunity-by-id.use-case';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { AnalysisQueuePort } from '../../domain/ports/analysis-queue.port';
import { Opportunity } from '../../domain/entities/opportunity.entity';
import { asOpportunityId } from '../../../shared/domain/typed-id';

describe('GetOpportunityByIdUseCase', () => {
  const baseOpportunity: Opportunity = {
    id: asOpportunityId('opp-detail-1'),
    title: 'Adquisicion de licencias de software',
    description: 'Suministro de licencias corporativas por 12 meses',
    contractingEntity: { name: 'MinTIC', taxId: '899999001' },
    location: { city: 'Bogotá', department: 'Bogotá D.C.' },
    amount: { amount: 180_000_000, currency: 'COP' },
    amountKnown: true,
    contractType: 'Suministro',
    procurementModality: 'Licitación pública',
    isCompetitive: true,
    categoryCode: '43230000',
    publishedAt: new Date('2026-10-01T00:00:00.000Z'),
    lastPublishedAt: new Date('2026-10-01T00:00:00.000Z'),
    closingDate: new Date('2026-10-30T17:00:00.000Z'),
    isOpenForSubmission: true,
    status: 'Published',
    source: {
      sourceName: 'SECOP',
      externalId: 'CO1.REQ.DETAIL1',
      humanReference: 'MINTIC-LIC-01',
      originalUrl: 'https://community.secop.gov.co/detail1',
    },
    analysis: null,
    changeHistory: [],
  };

  let storedOpportunity: Opportunity | null;
  let mockRepo: jest.Mocked<OpportunityRepositoryPort>;
  let mockQueue: jest.Mocked<AnalysisQueuePort>;
  let useCase: GetOpportunityByIdUseCase;

  beforeEach(() => {
    storedOpportunity = { ...baseOpportunity };
    mockRepo = {
      save: jest.fn(),
      saveMany: jest.fn(),
      saveAnalysis: jest.fn(),
      findById: jest.fn(async (_id) => storedOpportunity),
      findByExternalId: jest.fn(),
      findByExternalIds: jest.fn(),
      findByFilters: jest.fn(),
    };
    mockQueue = {
      enqueueAnalysis: jest.fn().mockResolvedValue(undefined),
    };
    useCase = new GetOpportunityByIdUseCase(mockRepo, mockQueue);
  });

  it('returns OpportunityNotFoundError when opportunity does not exist', async () => {
    storedOpportunity = null;
    const result = await useCase.execute({
      opportunityId: asOpportunityId('opp-missing'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('OpportunityNotFoundError');
      expect(result.error.opportunityId).toBe('opp-missing');
    }
    expect(mockQueue.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it('enqueues { summarize: true } and returns summaryStatus = "pending" when no summary exists', async () => {
    storedOpportunity = {
      ...baseOpportunity,
      analysis: {
        summary: '',
        summaryStatus: 'unavailable',
        requirements: [],
        embeddingGeneratedAt: new Date('2026-10-02T00:00:00.000Z'),
        contentHash: 'abc123',
      },
    };

    const result = await useCase.execute({
      opportunityId: baseOpportunity.id,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summaryStatus).toBe('pending');
      expect(result.value.opportunity.analysis?.summaryStatus).toBe('pending');
    }
    expect(mockQueue.enqueueAnalysis).toHaveBeenCalledTimes(1);
    expect(mockQueue.enqueueAnalysis).toHaveBeenCalledWith(baseOpportunity.id, {
      summarize: true,
    });
  });

  it('returns existing summaryStatus ("ready" or "fallback") without enqueueing a job when summary already exists', async () => {
    storedOpportunity = {
      ...baseOpportunity,
      analysis: {
        summary: 'Resumen analitico listo.',
        summaryStatus: 'ready',
        requirements: [],
        embeddingGeneratedAt: new Date('2026-10-02T00:00:00.000Z'),
        contentHash: 'abc123',
      },
    };

    const readyResult = await useCase.execute({
      opportunityId: baseOpportunity.id,
    });
    expect(readyResult.ok).toBe(true);
    if (readyResult.ok) {
      expect(readyResult.value.summaryStatus).toBe('ready');
      expect(readyResult.value.opportunity.analysis?.summary).toBe(
        'Resumen analitico listo.',
      );
    }
    expect(mockQueue.enqueueAnalysis).not.toHaveBeenCalled();

    storedOpportunity = {
      ...baseOpportunity,
      analysis: {
        summary: 'Primeros 300 caracteres...',
        summaryStatus: 'fallback',
        requirements: [],
        embeddingGeneratedAt: new Date('2026-10-02T00:00:00.000Z'),
        contentHash: 'abc123',
      },
    };

    const fallbackResult = await useCase.execute({
      opportunityId: baseOpportunity.id,
    });
    expect(fallbackResult.ok).toBe(true);
    if (fallbackResult.ok) {
      expect(fallbackResult.value.summaryStatus).toBe('fallback');
    }
    expect(mockQueue.enqueueAnalysis).not.toHaveBeenCalled();
  });
});
