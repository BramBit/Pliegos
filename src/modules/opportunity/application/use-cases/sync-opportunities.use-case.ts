import { randomUUID } from 'node:crypto';
import { Logger, LoggerService } from '@nestjs/common';
import { Result, ok, err } from '../../../shared/domain/result';
import {
  SourceUnavailableError,
  createSourceUnavailableError,
} from '../../../shared/domain/errors';
import {
  asOpportunityId,
  OpportunityId,
} from '../../../shared/domain/typed-id';
import {
  OpportunitySourcePort,
  SourceFetchOptions,
  SourceOpportunity,
} from '../../domain/ports/opportunity-source.port';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { AnalysisQueuePort } from '../../domain/ports/analysis-queue.port';
import { RecommendationRefreshQueuePort } from '../../../recommendation/domain/ports/recommendation-refresh-queue.port';
import {
  createOpportunity,
  withOpportunityChange,
  Opportunity,
  isRecommendable,
} from '../../domain/entities/opportunity.entity';
import { Change } from '../../domain/value-objects/opportunity.value-objects';
import { createMoney } from '../../domain/value-objects/money.vo';
import { WatchRepositoryPort } from '../../../recommendation/domain/ports/watch.repository.port';
import { AlertRepositoryPort } from '../../../alert/domain/ports/alert.repository.port';
import { AlertPlanner } from '../../../alert/domain/services/alert-planner';

export interface SyncOpportunitiesResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  unknownStatuses: Record<string, number>;
  durationMs: number;
  refreshTriggered?: boolean;
}

export interface ISyncOpportunitiesUseCase {
  execute(input: {
    since?: Date;
    maxRecords?: number;
    now?: Date;
  }): Promise<Result<SyncOpportunitiesResult, SourceUnavailableError>>;
}

const ONE_DAY_MS = 86_400_000;
const MATERIAL_CHANGE_FIELDS = new Set([
  'closingDate',
  'amount',
  'description',
  'status',
]);

export class SyncOpportunitiesUseCase implements ISyncOpportunitiesUseCase {
  private readonly logger: LoggerService;

  constructor(
    private readonly source: OpportunitySourcePort,
    private readonly repository: OpportunityRepositoryPort,
    private readonly analysisQueue?: AnalysisQueuePort,
    logger?: LoggerService,
    private readonly refreshQueue?: RecommendationRefreshQueuePort,
    private readonly watchRepository?: WatchRepositoryPort,
    private readonly alertRepository?: AlertRepositoryPort,
    private readonly secopSyncWindowDays: number = 14,
  ) {
    this.logger = logger ?? new Logger(SyncOpportunitiesUseCase.name);
  }

  async execute(input: {
    since?: Date;
    maxRecords?: number;
    now?: Date;
  }): Promise<Result<SyncOpportunitiesResult, SourceUnavailableError>> {
    const startMs = Date.now();
    const now = input.now ?? new Date();
    const counters = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
    const unknownStatuses: Record<string, number> = {};
    const seenInRun = new Set<string>();

    let existingWatermark: Date | null = null;
    if (this.repository.getSyncState) {
      try {
        const state = await this.repository.getSyncState('SECOP');
        existingWatermark = state?.watermark ?? null;
      } catch (dbError) {
        const msg =
          dbError instanceof Error ? dbError.message : String(dbError);
        this.logger.error(`Failed to read sync_state for SECOP: ${msg}`);
        throw dbError;
      }
    }

    const windowDays = this.secopSyncWindowDays;
    const windowStart = new Date(now.getTime() - windowDays * ONE_DAY_MS);

    let since: Date;
    if (input.since) {
      since = input.since;
    } else if (existingWatermark) {
      const overlapSince = new Date(existingWatermark.getTime() - ONE_DAY_MS);
      // If watermark is within the first day of the current window (e.g. capped by maxRecords),
      // keep windowStart so consecutive bounded runs do not walk backwards before the window.
      if (
        existingWatermark.getTime() >= windowStart.getTime() &&
        overlapSince.getTime() < windowStart.getTime()
      ) {
        since = windowStart;
      } else {
        since = overlapSince;
      }
    } else {
      since = windowStart;
    }

    let maxLastPublishedAt: Date | null = existingWatermark;
    const trackPublishedDate = (date: Date) => {
      if (!isNaN(date.getTime())) {
        if (
          !maxLastPublishedAt ||
          date.getTime() > maxLastPublishedAt.getTime()
        ) {
          maxLastPublishedAt = date;
        }
      }
    };

    // Pass 1: Incremental sync by fecha_de_ultima_publicaci ASC
    const incrementalResult = await this.runPass(
      since,
      {
        maxRecords: input.maxRecords,
        mode: 'incremental',
        now,
        onSkipped: () => {
          counters.skipped++;
        },
        onUnknownStatus: (rawStatus: string) => {
          unknownStatuses[rawStatus] = (unknownStatuses[rawStatus] ?? 0) + 1;
        },
      },
      counters,
      seenInRun,
      trackPublishedDate,
    );
    if (!incrementalResult.ok) {
      return incrementalResult;
    }

    // Pass 2: Currently open competitive processes regardless of watermark
    const openCompetitiveResult = await this.runPass(
      undefined,
      {
        maxRecords: input.maxRecords,
        mode: 'openCompetitive',
        now,
        onSkipped: () => {
          counters.skipped++;
        },
        onUnknownStatus: (rawStatus: string) => {
          unknownStatuses[rawStatus] = (unknownStatuses[rawStatus] ?? 0) + 1;
        },
      },
      counters,
      seenInRun,
      undefined,
    );
    if (!openCompetitiveResult.ok) {
      return openCompetitiveResult;
    }

    if (this.repository.saveSyncState) {
      try {
        await this.repository.saveSyncState('SECOP', {
          lastSuccessAt: new Date(),
          watermark: maxLastPublishedAt,
        });
      } catch (dbError) {
        const msg =
          dbError instanceof Error ? dbError.message : String(dbError);
        this.logger.error(`Failed to update sync_state for SECOP: ${msg}`);
        throw dbError;
      }
    }

    let refreshTriggered = false;
    if (
      (counters.created > 0 || counters.updated > 0) &&
      this.refreshQueue?.enqueueRefreshForAllProfiles
    ) {
      await this.refreshQueue.enqueueRefreshForAllProfiles();
      refreshTriggered = true;
    }

    const durationMs = Date.now() - startMs;
    const summary: SyncOpportunitiesResult = {
      created: counters.created,
      updated: counters.updated,
      unchanged: counters.unchanged,
      skipped: counters.skipped,
      unknownStatuses,
      durationMs,
      ...(refreshTriggered ? { refreshTriggered: true } : {}),
    };

    this.logger.log(
      `SECOP sync completed in ${durationMs}ms: created=${summary.created} updated=${summary.updated} unchanged=${summary.unchanged} skipped=${summary.skipped} unknownStatuses=${JSON.stringify(summary.unknownStatuses)}`,
    );

    return ok(summary);
  }

  private async runPass(
    since: Date | undefined,
    fetchOptions: SourceFetchOptions,
    counters: {
      created: number;
      updated: number;
      unchanged: number;
      skipped: number;
    },
    seenInRun: Set<string>,
    onLastPublishedAt?: (date: Date) => void,
  ): Promise<Result<void, SourceUnavailableError>> {
    const iterator = this.source
      .fetchPages(since, fetchOptions)
      [Symbol.asyncIterator]();

    while (true) {
      let nextResult: IteratorResult<SourceOpportunity[]>;
      try {
        nextResult = await iterator.next();
      } catch (sourceError) {
        const msg =
          sourceError instanceof Error
            ? sourceError.message
            : String(sourceError);
        this.logger.warn(
          `SECOP source unavailable during ${fetchOptions.mode ?? 'sync'}: ${msg}`,
        );
        return err(createSourceUnavailableError('SECOP'));
      }

      if (nextResult.done) break;

      try {
        await this.processPage(
          nextResult.value,
          counters,
          seenInRun,
          onLastPublishedAt,
          fetchOptions.now ?? new Date(),
        );
      } catch (dbError) {
        const msg =
          dbError instanceof Error ? dbError.message : String(dbError);
        this.logger.error(`Database error while persisting SECOP page: ${msg}`);
        throw dbError;
      }
    }

    return ok(undefined);
  }

  private async processPage(
    sourceOpportunities: SourceOpportunity[],
    counters: {
      created: number;
      updated: number;
      unchanged: number;
      skipped: number;
    },
    seenInRun: Set<string>,
    onLastPublishedAt?: (date: Date) => void,
    now: Date = new Date(),
  ): Promise<void> {
    const validItems: SourceOpportunity[] = [];
    for (const src of sourceOpportunities) {
      if (seenInRun.has(src.externalId)) {
        continue;
      }
      if (!src.publishedAt || isNaN(src.publishedAt.getTime())) {
        counters.skipped++;
        continue;
      }
      seenInRun.add(src.externalId);
      validItems.push(src);
    }

    if (validItems.length === 0) return;

    const externalIds = validItems.map((item) => item.externalId);
    const existingRecords =
      await this.repository.findByExternalIds(externalIds);
    const existingByExternalId = new Map<string, Opportunity>(
      existingRecords.map((opp) => [opp.source.externalId, opp]),
    );

    const toSave: Opportunity[] = [];
    const toEnqueue: OpportunityId[] = [];
    const opportunitiesWithMaterialChanges: Array<{
      id: OpportunityId;
      materialChanges: Change[];
    }> = [];
    let pageCreated = 0;
    let pageUpdated = 0;
    let pageUnchanged = 0;
    let pageSkipped = 0;

    for (const src of validItems) {
      onLastPublishedAt?.(src.lastPublishedAt);

      const existing = existingByExternalId.get(src.externalId);
      if (!existing) {
        const moneyResult = createMoney(
          src.amount !== null && src.amount >= 0 ? src.amount : 0,
        );
        const amount = moneyResult.ok
          ? moneyResult.value
          : { amount: 0, currency: 'COP' as const };

        const newOppResult = createOpportunity({
          id: asOpportunityId(randomUUID()),
          title: src.title,
          description: src.description,
          contractingEntity: {
            name: src.entityName,
            taxId: src.entityTaxId,
          },
          location: {
            city: src.city,
            department: src.department,
          },
          amount,
          amountKnown: src.amount !== null,
          contractType: src.contractType,
          procurementModality: src.procurementModality,
          isCompetitive: src.isCompetitive,
          categoryCode: src.categoryCode,
          publishedAt: src.publishedAt,
          lastPublishedAt: src.lastPublishedAt,
          closingDate: src.closingDate,
          isOpenForSubmission: src.isOpenForSubmission,
          status: src.status,
          sourceStatus: src.sourceStatus ?? null,
          source: {
            sourceName: 'SECOP',
            externalId: src.externalId,
            humanReference: src.humanReference,
            originalUrl: src.originalUrl,
          },
        });

        if (newOppResult.ok) {
          toSave.push(newOppResult.value);
          if (isRecommendable(newOppResult.value, now)) {
            toEnqueue.push(newOppResult.value.id);
          }
          pageCreated++;
        } else {
          pageSkipped++;
        }
      } else {
        const changes = this.compareSourceWithStored(existing, src);
        const entityChanged =
          existing.contractingEntity.name !== src.entityName ||
          existing.contractingEntity.taxId !== src.entityTaxId;

        if (changes.length > 0 || entityChanged) {
          let updatedOpp: Opportunity = existing;
          for (const change of changes) {
            updatedOpp = withOpportunityChange(updatedOpp, change);
          }

          const materialChanges = changes.filter((c) => c.material);
          if (materialChanges.length > 0) {
            opportunitiesWithMaterialChanges.push({
              id: existing.id,
              materialChanges,
            });
          }

          const moneyResult = createMoney(
            src.amount !== null && src.amount >= 0 ? src.amount : 0,
          );
          const amount = moneyResult.ok ? moneyResult.value : updatedOpp.amount;

          const shouldEnqueueAnalysis =
            existing.title !== src.title ||
            existing.description !== src.description ||
            existing.contractingEntity.name !== src.entityName;

          updatedOpp = {
            ...updatedOpp,
            title: src.title,
            description: src.description,
            contractingEntity: {
              name: src.entityName,
              taxId: src.entityTaxId,
            },
            amount,
            amountKnown: src.amount !== null,
            isCompetitive: src.isCompetitive,
            categoryCode: src.categoryCode,
            lastPublishedAt: src.lastPublishedAt,
            status: src.status !== 'Unknown' ? src.status : existing.status,
            sourceStatus: src.sourceStatus ?? existing.sourceStatus ?? null,
            closingDate: src.closingDate,
            isOpenForSubmission: src.isOpenForSubmission,
          };

          toSave.push(updatedOpp);
          if (shouldEnqueueAnalysis && isRecommendable(updatedOpp, now)) {
            toEnqueue.push(updatedOpp.id);
          }
          pageUpdated++;
        } else {
          pageUnchanged++;
        }
      }
    }

    if (toSave.length > 0) {
      await this.repository.saveMany(toSave);
    }

    if (
      this.watchRepository &&
      this.alertRepository &&
      opportunitiesWithMaterialChanges.length > 0
    ) {
      for (const item of opportunitiesWithMaterialChanges) {
        const watchers = await this.watchRepository.findWatchers(item.id);
        if (watchers.length > 0) {
          const alerts = AlertPlanner.planAlerts(
            item.id,
            item.materialChanges,
            watchers,
          );
          if (alerts.length > 0) {
            await this.alertRepository.createMany(alerts);
          }
        }
      }
    }

    counters.created += pageCreated;
    counters.updated += pageUpdated;
    counters.unchanged += pageUnchanged;
    counters.skipped += pageSkipped;

    if (this.analysisQueue) {
      for (const id of toEnqueue) {
        await this.analysisQueue.enqueueAnalysis(id, { summarize: false });
      }
    }
  }

  private compareSourceWithStored(
    existing: Opportunity,
    src: SourceOpportunity,
  ): Change[] {
    const changes: Change[] = [];
    const now = new Date();

    const pushChange = (
      field: string,
      previousValue: string,
      newValue: string,
    ) => {
      changes.push({
        field,
        previousValue,
        newValue,
        detectedAt: now,
        material: MATERIAL_CHANGE_FIELDS.has(field),
      });
    };

    if (existing.title !== src.title) {
      pushChange('title', existing.title, src.title);
    }

    if (existing.description !== src.description) {
      pushChange('description', existing.description, src.description);
    }

    const oldAmount = existing.amountKnown
      ? String(existing.amount.amount)
      : 'null';
    const newAmount = src.amount !== null ? String(src.amount) : 'null';
    if (oldAmount !== newAmount) {
      pushChange('amount', oldAmount, newAmount);
    }

    const oldClosing = existing.closingDate
      ? existing.closingDate.toISOString()
      : 'null';
    const newClosing = src.closingDate ? src.closingDate.toISOString() : 'null';
    if (oldClosing !== newClosing) {
      pushChange('closingDate', oldClosing, newClosing);
    }

    if (src.status !== 'Unknown' && existing.status !== src.status) {
      pushChange('status', existing.status, src.status);
    }

    if (existing.isOpenForSubmission !== src.isOpenForSubmission) {
      pushChange(
        'isOpenForSubmission',
        String(existing.isOpenForSubmission),
        String(src.isOpenForSubmission),
      );
    }

    const oldCategory = existing.categoryCode ?? 'null';
    const newCategory = src.categoryCode ?? 'null';
    if (oldCategory !== newCategory) {
      pushChange('categoryCode', oldCategory, newCategory);
    }

    return changes;
  }
}
