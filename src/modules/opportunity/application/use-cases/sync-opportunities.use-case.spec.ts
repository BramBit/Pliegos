import { SyncOpportunitiesUseCase } from './sync-opportunities.use-case';
import {
  OpportunitySourcePort,
  SourceFetchOptions,
  SourceOpportunity,
} from '../../domain/ports/opportunity-source.port';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { AnalysisQueuePort } from '../../domain/ports/analysis-queue.port';
import { Opportunity } from '../../domain/entities/opportunity.entity';
import { OpportunityFilters } from '../../domain/value-objects/opportunity-filters';
import { OpportunityId } from '../../../shared/domain/typed-id';

class FakeOpportunitySource implements OpportunitySourcePort {
  constructor(
    public processes: SourceOpportunity[] = [],
    public shouldFail = false,
    public skippedRecords = 0,
  ) {}

  async *fetchPages(
    _since?: Date,
    options?: SourceFetchOptions,
  ): AsyncIterable<SourceOpportunity[]> {
    if (this.shouldFail) {
      throw new Error('Socrata API connection timeout');
    }
    for (let i = 0; i < this.skippedRecords; i++) {
      options?.onSkipped?.();
    }
    if (this.processes.length > 0) {
      yield this.processes;
    }
  }
}

class FakeOpportunityRepository implements OpportunityRepositoryPort {
  public opportunities: Map<string, Opportunity> = new Map();

  async save(opportunity: Opportunity): Promise<void> {
    this.opportunities.set(opportunity.source.externalId, opportunity);
  }

  async findById(id: OpportunityId): Promise<Opportunity | null> {
    for (const opp of this.opportunities.values()) {
      if (opp.id === id) return opp;
    }
    return null;
  }

  async findByExternalId(externalId: string): Promise<Opportunity | null> {
    return this.opportunities.get(externalId) ?? null;
  }

  async findByFilters(_filters: OpportunityFilters): Promise<Opportunity[]> {
    return Array.from(this.opportunities.values());
  }
}

class FakeAnalysisQueue implements AnalysisQueuePort {
  public queuedOpportunityIds: OpportunityId[] = [];

  async enqueueAnalysis(opportunityId: OpportunityId): Promise<void> {
    this.queuedOpportunityIds.push(opportunityId);
  }
}

describe('SyncOpportunitiesUseCase', () => {
  let fakeSource: FakeOpportunitySource;
  let fakeRepo: FakeOpportunityRepository;
  let fakeQueue: FakeAnalysisQueue;
  let useCase: SyncOpportunitiesUseCase;

  const sourceSample: SourceOpportunity = {
    externalId: 'CO1.REQ.2577563',
    humanReference: 'EDP-545-2022',
    title: 'Adquisición de infraestructura de servidores',
    description: 'Compra de servidores de cómputo de alto rendimiento para centros de datos',
    entityName: 'Secretaría de Educación',
    entityTaxId: '899999061-9',
    city: 'Bogotá',
    department: 'Bogotá D.C.',
    amount: 150_000_000,
    contractType: 'Suministro',
    procurementModality: 'Licitación pública',
    isCompetitive: true,
    categoryCode: '43211500',
    publishedAt: new Date('2026-10-01T08:00:00.000Z'),
    lastPublishedAt: new Date('2026-10-01T08:00:00.000Z'),
    closingDate: new Date('2026-10-25T17:00:00.000Z'),
    isOpenForSubmission: true,
    status: 'Published',
    originalUrl: 'https://community.secop.gov.co/process/2577563',
  };

  beforeEach(() => {
    fakeSource = new FakeOpportunitySource([sourceSample]);
    fakeRepo = new FakeOpportunityRepository();
    fakeQueue = new FakeAnalysisQueue();
    useCase = new SyncOpportunitiesUseCase(fakeSource, fakeRepo, fakeQueue);
  });

  it('returns SourceUnavailableError when OpportunitySourcePort throws', async () => {
    fakeSource.shouldFail = true;

    const result = await useCase.execute({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('SourceUnavailableError');
      expect(result.error.sourceName).toBe('SECOP');
    }
    expect(fakeRepo.opportunities.size).toBe(0);
    expect(fakeQueue.queuedOpportunityIds).toHaveLength(0);
  });

  it('ingests new opportunities, persists them with description and flags, queues analysis, and returns created count', async () => {
    const result = await useCase.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.created).toBe(1);
      expect(result.value.updated).toBe(0);
      expect(result.value.skipped).toBe(0);
    }

    const saved = await fakeRepo.findByExternalId('CO1.REQ.2577563');
    expect(saved).not.toBeNull();
    expect(saved?.title).toBe('Adquisición de infraestructura de servidores');
    expect(saved?.description).toBe(
      'Compra de servidores de cómputo de alto rendimiento para centros de datos',
    );
    expect(saved?.amount.amount).toBe(150_000_000);
    expect(saved?.amountKnown).toBe(true);
    expect(saved?.isCompetitive).toBe(true);
    expect(saved?.categoryCode).toBe('43211500');
    expect(saved?.source.humanReference).toBe('EDP-545-2022');
    expect(saved?.status).toBe('Published');

    expect(fakeQueue.queuedOpportunityIds).toHaveLength(1);
    expect(fakeQueue.queuedOpportunityIds[0]).toBe(saved?.id);
  });

  it('counts records skipped by the source adapter', async () => {
    fakeSource.skippedRecords = 2;
    const result = await useCase.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.created).toBe(1);
      expect(result.value.skipped).toBe(2);
    }
  });

  it('detects changes on existing opportunity, updates record with change history, and queues re-analysis', async () => {
    // First sync: creates opportunity
    await useCase.execute({});
    expect(fakeRepo.opportunities.size).toBe(1);

    // Second sync: updated closingDate and status
    const amendedSource: SourceOpportunity = {
      ...sourceSample,
      closingDate: new Date('2026-11-10T17:00:00.000Z'),
      status: 'Awarded',
      isOpenForSubmission: false,
    };
    fakeSource.processes = [amendedSource];

    const result = await useCase.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.created).toBe(0);
      expect(result.value.updated).toBe(1);
    }

    const updated = await fakeRepo.findByExternalId('CO1.REQ.2577563');
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('Awarded');
    expect(updated?.closingDate).toEqual(new Date('2026-11-10T17:00:00.000Z'));
    expect(updated?.changeHistory.length).toBeGreaterThanOrEqual(1);

    const closingChange = updated?.changeHistory.find((c) => c.field === 'closingDate');
    expect(closingChange).toBeDefined();
    expect(closingChange?.previousValue).toBe('2026-10-25T17:00:00.000Z');
    expect(closingChange?.newValue).toBe('2026-11-10T17:00:00.000Z');

    // 2 total queued jobs (1 for initial creation, 1 for update)
    expect(fakeQueue.queuedOpportunityIds).toHaveLength(2);
  });

  it('does nothing when existing opportunity has identical data', async () => {
    // First sync
    await useCase.execute({});
    expect(fakeQueue.queuedOpportunityIds).toHaveLength(1);

    // Second sync with identical data
    const result = await useCase.execute({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.created).toBe(0);
      expect(result.value.updated).toBe(0);
    }
    // No new analysis queued
    expect(fakeQueue.queuedOpportunityIds).toHaveLength(1);
  });
});
