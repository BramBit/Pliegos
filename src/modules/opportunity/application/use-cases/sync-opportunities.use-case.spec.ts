import { LoggerService } from '@nestjs/common';
import { SyncOpportunitiesUseCase } from './sync-opportunities.use-case';
import {
  OpportunitySourcePort,
  SourceFetchOptions,
  SourceOpportunity,
} from '../../domain/ports/opportunity-source.port';
import {
  OpportunityRepositoryPort,
  SyncState,
} from '../../domain/ports/opportunity.repository.port';
import { AnalysisQueuePort } from '../../domain/ports/analysis-queue.port';
import { Opportunity } from '../../domain/entities/opportunity.entity';
import { OpportunityFilters } from '../../domain/value-objects/opportunity-filters';
import { OpportunityId, asProfileId } from '../../../shared/domain/typed-id';
import {
  WatchRepositoryPort,
  WatcherProfile,
} from '../../../recommendation/domain/ports/watch.repository.port';
import { AlertRepositoryPort } from '../../../alert/domain/ports/alert.repository.port';
import { Alert } from '../../../alert/domain/entities/alert.entity';

class FakeOpportunitySource implements OpportunitySourcePort {
  public calls: Array<{ since?: Date; options?: SourceFetchOptions }> = [];
  public pages: SourceOpportunity[][] = [];
  public openCompetitiveProcesses: SourceOpportunity[] = [];
  public failOnPageIndex: number | null = null;
  public unknownStatusLabels: string[] = [];

  constructor(
    public processes: SourceOpportunity[] = [],
    public shouldFail = false,
    public skippedRecords = 0,
  ) {}

  async *fetchPages(
    since?: Date,
    options?: SourceFetchOptions,
  ): AsyncIterable<SourceOpportunity[]> {
    this.calls.push({ since, options });
    if (this.shouldFail) {
      throw new Error('Socrata API connection timeout');
    }

    if (options?.mode === 'openCompetitive') {
      if (this.openCompetitiveProcesses.length > 0) {
        yield this.openCompetitiveProcesses;
      }
      return;
    }

    for (let i = 0; i < this.skippedRecords; i++) {
      options?.onSkipped?.();
    }
    for (const label of this.unknownStatusLabels) {
      options?.onUnknownStatus?.(label);
    }

    const pagesToYield =
      this.pages.length > 0
        ? this.pages
        : this.processes.length > 0
          ? [this.processes]
          : [];

    for (let idx = 0; idx < pagesToYield.length; idx++) {
      if (this.failOnPageIndex !== null && idx === this.failOnPageIndex) {
        throw new Error(`Socrata page ${idx} failed`);
      }
      yield pagesToYield[idx];
    }
  }
}

class FakeOpportunityRepository implements OpportunityRepositoryPort {
  public opportunities: Map<string, Opportunity> = new Map();
  public syncStates: Map<string, SyncState> = new Map();
  public findByExternalIdsCalls = 0;
  public saveManyCalls = 0;
  public shouldFailOnSaveMany = false;

  async save(opportunity: Opportunity): Promise<void> {
    this.opportunities.set(opportunity.source.externalId, opportunity);
  }

  async saveMany(opportunities: Opportunity[]): Promise<void> {
    this.saveManyCalls++;
    if (this.shouldFailOnSaveMany) {
      throw new Error('Postgres connection terminated unexpectedly');
    }
    for (const opportunity of opportunities) {
      this.opportunities.set(opportunity.source.externalId, opportunity);
    }
  }

  async saveAnalysis(
    id: OpportunityId,
    analysis: Opportunity['analysis'],
  ): Promise<void> {
    for (const [extId, opp] of this.opportunities.entries()) {
      if (opp.id === id) {
        this.opportunities.set(extId, { ...opp, analysis });
      }
    }
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

  async findByExternalIds(externalIds: string[]): Promise<Opportunity[]> {
    this.findByExternalIdsCalls++;
    const found: Opportunity[] = [];
    for (const extId of externalIds) {
      const opp = this.opportunities.get(extId);
      if (opp) found.push(opp);
    }
    return found;
  }

  async findByFilters(_filters: OpportunityFilters): Promise<Opportunity[]> {
    return Array.from(this.opportunities.values());
  }

  async getSyncState(source: string): Promise<SyncState | null> {
    return this.syncStates.get(source) ?? null;
  }

  async saveSyncState(
    source: string,
    state: { lastSuccessAt: Date; watermark: Date | null },
  ): Promise<void> {
    const prev = this.syncStates.get(source);
    let watermark = state.watermark ?? prev?.watermark ?? null;
    if (prev?.watermark && state.watermark) {
      watermark =
        state.watermark.getTime() >= prev.watermark.getTime()
          ? state.watermark
          : prev.watermark;
    }
    this.syncStates.set(source, {
      source,
      lastSuccessAt: state.lastSuccessAt,
      watermark,
    });
  }
}

class FakeAnalysisQueue implements AnalysisQueuePort {
  public queuedOpportunityIds: OpportunityId[] = [];
  public queuedJobs: Array<{
    opportunityId: OpportunityId;
    summarize?: boolean;
  }> = [];

  async enqueueAnalysis(
    opportunityId: OpportunityId,
    options?: { summarize?: boolean },
  ): Promise<void> {
    this.queuedOpportunityIds.push(opportunityId);
    this.queuedJobs.push({ opportunityId, summarize: options?.summarize });
  }
}

class FakeWatchRepository implements Partial<WatchRepositoryPort> {
  public watchersByOpp: Map<string, WatcherProfile[]> = new Map();
  public findWatchersCalls = 0;

  async findWatchers(opportunityId: OpportunityId): Promise<WatcherProfile[]> {
    this.findWatchersCalls++;
    return this.watchersByOpp.get(opportunityId) ?? [];
  }
}

class FakeAlertRepository implements Partial<AlertRepositoryPort> {
  public createdAlerts: Alert[] = [];
  public createManyCalls = 0;

  async createMany(alerts: Alert[]): Promise<void> {
    this.createManyCalls++;
    for (const a of alerts) {
      const exists = this.createdAlerts.some(
        (existing) =>
          existing.profileId === a.profileId &&
          existing.opportunityId === a.opportunityId &&
          existing.trigger === a.trigger &&
          existing.changeKey === a.changeKey,
      );
      if (!exists) {
        this.createdAlerts.push(a);
      }
    }
  }
}

describe('SyncOpportunitiesUseCase', () => {
  let fakeSource: FakeOpportunitySource;
  let fakeRepo: FakeOpportunityRepository;
  let fakeQueue: FakeAnalysisQueue;
  let fakeWatchRepo: FakeWatchRepository;
  let fakeAlertRepo: FakeAlertRepository;
  let fakeLogger: LoggerService & { logs: string[]; errors: string[] };
  let useCase: SyncOpportunitiesUseCase;

  const sourceSample: SourceOpportunity = {
    externalId: 'CO1.REQ.2577563',
    humanReference: 'EDP-545-2022',
    title: 'Adquisición de infraestructura de servidores',
    description:
      'Compra de servidores de cómputo de alto rendimiento para centros de datos',
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
    lastPublishedAt: new Date('2026-10-10T00:00:00.000Z'),
    closingDate: new Date('2026-10-25T17:00:00.000Z'),
    isOpenForSubmission: true,
    status: 'Published',
    originalUrl: 'https://community.secop.gov.co/process/2577563',
  };

  beforeEach(() => {
    fakeSource = new FakeOpportunitySource([sourceSample]);
    fakeRepo = new FakeOpportunityRepository();
    fakeQueue = new FakeAnalysisQueue();
    fakeWatchRepo = new FakeWatchRepository();
    fakeAlertRepo = new FakeAlertRepository();
    fakeLogger = {
      log: jest.fn((msg: string) => fakeLogger.logs.push(msg)),
      error: jest.fn((msg: string) => fakeLogger.errors.push(msg)),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      logs: [],
      errors: [],
    };
    useCase = new SyncOpportunitiesUseCase(
      fakeSource,
      fakeRepo,
      fakeQueue,
      fakeLogger,
      undefined,
      fakeWatchRepo as any,
      fakeAlertRepo as any,
    );
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

  it('logs and propagates database errors instead of swallowing them as SourceUnavailableError', async () => {
    fakeRepo.shouldFailOnSaveMany = true;

    await expect(useCase.execute({})).rejects.toThrow(
      'Postgres connection terminated unexpectedly',
    );
    expect(fakeLogger.errors.some((e) => e.includes('Database error'))).toBe(
      true,
    );
  });

  it('ingests new opportunities in one batch per page, updates watermark, and logs one summary line', async () => {
    fakeSource.unknownStatusLabels = ['EstadoRaro', 'EstadoRaro'];
    const now = new Date('2026-10-16T12:00:00.000Z');
    const result = await useCase.execute({ now });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.created).toBe(1);
      expect(result.value.updated).toBe(0);
      expect(result.value.unchanged).toBe(0);
      expect(result.value.skipped).toBe(0);
      expect(result.value.unknownStatuses).toEqual({ EstadoRaro: 2 });
      expect(typeof result.value.durationMs).toBe('number');
    }

    // Without watermark, since = now - 14 days
    expect(fakeSource.calls[0].since).toEqual(
      new Date('2026-10-02T12:00:00.000Z'),
    );
    // Second pass runs with mode: 'openCompetitive'
    expect(fakeSource.calls[1].options?.mode).toBe('openCompetitive');

    // Batch lookup and save per page
    expect(fakeRepo.findByExternalIdsCalls).toBe(1);
    expect(fakeRepo.saveManyCalls).toBe(1);

    // Watermark saved as max lastPublishedAt seen
    const syncState = await fakeRepo.getSyncState('SECOP');
    expect(syncState?.watermark).toEqual(new Date('2026-10-10T00:00:00.000Z'));

    // Summary log line emitted once
    expect(fakeLogger.logs).toHaveLength(1);
    expect(fakeLogger.logs[0]).toContain('SECOP sync completed');
  });

  it('second run over the same fixture gives created = 0 and updated = 0, using since = watermark minus 1 day', async () => {
    const now = new Date('2026-10-16T12:00:00.000Z');

    // First run
    const first = await useCase.execute({ now });
    expect(first.ok && first.value.created).toBe(1);

    // Second run over the same fixture
    const second = await useCase.execute({ now });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.created).toBe(0);
      expect(second.value.updated).toBe(0);
      expect(second.value.unchanged).toBe(1);
    }

    // Watermark was 2026-10-10T00:00:00.000Z -> since on second run is watermark - 1 day (2026-10-09T00:00:00.000Z)
    expect(fakeSource.calls[2].since).toEqual(
      new Date('2026-10-09T00:00:00.000Z'),
    );
    // No new analysis job queued
    expect(fakeQueue.queuedOpportunityIds).toHaveLength(1);
  });

  it('a changed closingDate gives updated = 1 with one Change marked material: true', async () => {
    await useCase.execute({});
    expect(fakeRepo.opportunities.size).toBe(1);

    // Change only closingDate
    const amendedSource: SourceOpportunity = {
      ...sourceSample,
      closingDate: new Date('2026-11-10T17:00:00.000Z'),
    };
    fakeSource.processes = [amendedSource];

    const result = await useCase.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.created).toBe(0);
      expect(result.value.updated).toBe(1);
      expect(result.value.unchanged).toBe(0);
    }

    const updated = await fakeRepo.findByExternalId('CO1.REQ.2577563');
    expect(updated).not.toBeNull();
    expect(updated?.closingDate).toEqual(new Date('2026-11-10T17:00:00.000Z'));
    expect(updated?.changeHistory).toHaveLength(1);
    expect(updated?.changeHistory[0]).toEqual(
      expect.objectContaining({
        field: 'closingDate',
        previousValue: '2026-10-25T17:00:00.000Z',
        newValue: '2026-11-10T17:00:00.000Z',
        material: true,
      }),
    );

    // A change of closingDate or status does NOT enqueue re-analysis (only initial creation was enqueued)
    expect(fakeQueue.queuedOpportunityIds).toHaveLength(1);
  });

  it('enqueues re-analysis when title, description, or entity changed, but not on status/closingDate change', async () => {
    await useCase.execute({});
    expect(fakeQueue.queuedOpportunityIds).toHaveLength(1);

    // Status change alone (still recommendable) -> does not enqueue
    fakeSource.processes = [{ ...sourceSample, status: 'Amended' }];
    await useCase.execute({});
    expect(fakeQueue.queuedOpportunityIds).toHaveLength(1);

    // Description change on recommendable opportunity -> enqueues
    fakeSource.processes = [
      {
        ...sourceSample,
        status: 'Amended',
        description: 'Descripción actualizada con nuevos servidores GPU',
      },
    ];
    await useCase.execute({});
    expect(fakeQueue.queuedOpportunityIds).toHaveLength(2);
  });

  it('does not enqueue analysis for non-recommendable opportunities', async () => {
    // Non-competitive (direct contracting)
    fakeSource.processes = [
      {
        ...sourceSample,
        externalId: 'NON-REC-1',
        isCompetitive: false,
      },
      {
        ...sourceSample,
        externalId: 'NON-REC-2',
        status: 'Awarded',
      },
      {
        ...sourceSample,
        externalId: 'NON-REC-3',
        closingDate: new Date('2020-01-01T00:00:00.000Z'),
      },
    ];
    await useCase.execute({});
    // None of these should be enqueued for analysis
    expect(fakeQueue.queuedOpportunityIds).toHaveLength(0);
  });

  it('compares all 7 tracked fields and sets material: true only on closingDate, amount, description, and status', async () => {
    await useCase.execute({});

    const modifiedAll: SourceOpportunity = {
      ...sourceSample,
      title: 'Nuevo título',
      description: 'Nueva descripción',
      amount: 200_000_000,
      closingDate: new Date('2026-11-01T17:00:00.000Z'),
      status: 'Closed',
      isOpenForSubmission: false,
      categoryCode: '81111500',
    };
    fakeSource.processes = [modifiedAll];

    const result = await useCase.execute({});
    expect(result.ok && result.value.updated).toBe(1);

    const updated = await fakeRepo.findByExternalId(sourceSample.externalId);
    const byField = new Map(updated!.changeHistory.map((c) => [c.field, c]));

    expect(byField.size).toBe(7);
    expect(byField.get('closingDate')?.material).toBe(true);
    expect(byField.get('amount')?.material).toBe(true);
    expect(byField.get('description')?.material).toBe(true);
    expect(byField.get('status')?.material).toBe(true);
    expect(byField.get('title')?.material).toBe(false);
    expect(byField.get('isOpenForSubmission')?.material).toBe(false);
    expect(byField.get('categoryCode')?.material).toBe(false);
  });

  it('a failed page does not move the watermark', async () => {
    const initialWatermark = new Date('2026-10-05T00:00:00.000Z');
    await fakeRepo.saveSyncState('SECOP', {
      lastSuccessAt: new Date('2026-10-06T00:00:00.000Z'),
      watermark: initialWatermark,
    });

    const page1Record: SourceOpportunity = {
      ...sourceSample,
      externalId: 'CO1.REQ.PAGE1',
      lastPublishedAt: new Date('2026-10-12T00:00:00.000Z'),
    };
    const page2Record: SourceOpportunity = {
      ...sourceSample,
      externalId: 'CO1.REQ.PAGE2',
      lastPublishedAt: new Date('2026-10-14T00:00:00.000Z'),
    };
    fakeSource.pages = [[page1Record], [page2Record]];
    fakeSource.failOnPageIndex = 1; // fail on second page

    const result = await useCase.execute({
      now: new Date('2026-10-16T00:00:00.000Z'),
    });

    expect(result.ok).toBe(false);
    const stateAfter = await fakeRepo.getSyncState('SECOP');
    expect(stateAfter?.watermark).toEqual(initialWatermark);
  });

  it('fetches open competitive processes in a second pass regardless of watermark', async () => {
    const openCompOpp: SourceOpportunity = {
      ...sourceSample,
      externalId: 'CO1.REQ.OPEN-COMP-1',
      lastPublishedAt: new Date('2026-09-01T00:00:00.000Z'), // older than watermark
      closingDate: new Date('2026-11-01T00:00:00.000Z'),
      isOpenForSubmission: true,
      isCompetitive: true,
    };
    fakeSource.openCompetitiveProcesses = [openCompOpp];

    const result = await useCase.execute({
      now: new Date('2026-10-16T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.created).toBe(2);
    }
    expect(
      await fakeRepo.findByExternalId('CO1.REQ.OPEN-COMP-1'),
    ).not.toBeNull();
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

  it('never triggers LLM summarization during sync (enqueues embed-only jobs with summarize: false)', async () => {
    const result = await useCase.execute({});
    expect(result.ok).toBe(true);
    expect(fakeQueue.queuedJobs).toHaveLength(1);
    expect(fakeQueue.queuedJobs[0].summarize).toBe(false);
  });

  it('creates no alerts when an unwatched opportunity changes materially', async () => {
    // 1st sync: opportunity ingested
    await useCase.execute({});
    expect(fakeAlertRepo.createdAlerts).toHaveLength(0);

    // 2nd sync: status changes materially
    const modified: SourceOpportunity = { ...sourceSample, status: 'Closed' };
    fakeSource.processes = [modified];

    const result = await useCase.execute({});
    expect(result.ok).toBe(true);
    expect(fakeAlertRepo.createdAlerts).toHaveLength(0);
    expect(fakeWatchRepo.findWatchersCalls).toBeGreaterThan(0);
  });

  it('creates alerts for watching profiles with alerts_enabled = true on material changes', async () => {
    // Ingest initial opportunity
    await useCase.execute({});
    const stored = (await fakeRepo.findByExternalId(sourceSample.externalId))!;

    // Set up watchers: watcher 1 with alerts enabled, watcher 2 disabled
    const watcher1: WatcherProfile = {
      profileId: asProfileId('prof-1'),
      alertsEnabled: true,
      contactEmail: 'user1@test.com',
    };
    const watcher2: WatcherProfile = {
      profileId: asProfileId('prof-2'),
      alertsEnabled: false,
      contactEmail: 'user2@test.com',
    };
    fakeWatchRepo.watchersByOpp.set(stored.id, [watcher1, watcher2]);

    // Material changes: status changed (StatusChange) + amount changed (Amendment)
    const modified: SourceOpportunity = {
      ...sourceSample,
      status: 'Closed',
      amount: 200_000_000,
    };
    fakeSource.processes = [modified];

    const result = await useCase.execute({});
    expect(result.ok).toBe(true);

    // Only watcher1 receives alerts; 2 material changes -> 2 alerts
    expect(fakeAlertRepo.createdAlerts).toHaveLength(2);
    expect(
      fakeAlertRepo.createdAlerts.every((a) => a.profileId === 'prof-1'),
    ).toBe(true);
    expect(fakeAlertRepo.createdAlerts.map((a) => a.trigger).sort()).toEqual([
      'Amendment',
      'StatusChange',
    ]);
  });

  it('creates no duplicate alerts when the same sync is run twice', async () => {
    // Ingest initial opportunity
    await useCase.execute({});
    const stored = (await fakeRepo.findByExternalId(sourceSample.externalId))!;

    const watcher: WatcherProfile = {
      profileId: asProfileId('prof-watch'),
      alertsEnabled: true,
      contactEmail: 'watcher@test.com',
    };
    fakeWatchRepo.watchersByOpp.set(stored.id, [watcher]);

    // Modify closing date (material change)
    const modified: SourceOpportunity = {
      ...sourceSample,
      closingDate: new Date('2026-11-30T17:00:00.000Z'),
    };
    fakeSource.processes = [modified];

    // Run 1: alert is created
    await useCase.execute({});
    expect(fakeAlertRepo.createdAlerts).toHaveLength(1);
    const alertId = fakeAlertRepo.createdAlerts[0].id;

    // Run 2: same data from source
    await useCase.execute({});
    // No duplicate alerts created
    expect(fakeAlertRepo.createdAlerts).toHaveLength(1);
    expect(fakeAlertRepo.createdAlerts[0].id).toBe(alertId);
  });
});
