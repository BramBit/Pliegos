import { randomUUID } from 'node:crypto';
import { Result, ok, err } from '../../../shared/domain/result';
import {
  SourceUnavailableError,
  createSourceUnavailableError,
} from '../../../shared/domain/errors';
import { asOpportunityId } from '../../../shared/domain/typed-id';
import {
  OpportunitySourcePort,
  SourceOpportunity,
} from '../../domain/ports/opportunity-source.port';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { AnalysisQueuePort } from '../../domain/ports/analysis-queue.port';
import {
  createOpportunity,
  withOpportunityChange,
  Opportunity,
} from '../../domain/entities/opportunity.entity';
import { Change } from '../../domain/value-objects/opportunity.value-objects';
import { createMoney } from '../../domain/value-objects/money.vo';

export interface ISyncOpportunitiesUseCase {
  execute(input: {
    since?: Date;
    maxRecords?: number;
  }): Promise<
    Result<{ created: number; updated: number; skipped: number }, SourceUnavailableError>
  >;
}

export class SyncOpportunitiesUseCase implements ISyncOpportunitiesUseCase {
  constructor(
    private readonly source: OpportunitySourcePort,
    private readonly repository: OpportunityRepositoryPort,
    private readonly analysisQueue?: AnalysisQueuePort,
  ) {}

  async execute(input: {
    since?: Date;
    maxRecords?: number;
  }): Promise<
    Result<{ created: number; updated: number; skipped: number }, SourceUnavailableError>
  > {
    const counters = { created: 0, updated: 0, skipped: 0 };
    const fetchOptions = {
      maxRecords: input.maxRecords,
      onSkipped: () => {
        counters.skipped++;
      },
    };

    try {
      for await (const page of this.source.fetchPages(input.since, fetchOptions)) {
        await this.processPage(page, counters);
      }
    } catch {
      return err(createSourceUnavailableError('SECOP'));
    }

    return ok(counters);
  }

  private async processPage(
    sourceOpportunities: SourceOpportunity[],
    counters: { created: number; updated: number; skipped: number },
  ): Promise<void> {
    for (const src of sourceOpportunities) {
      if (!src.publishedAt || isNaN(src.publishedAt.getTime())) {
        counters.skipped++;
        continue;
      }

      const existing = await this.repository.findByExternalId(src.externalId);

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
          source: {
            sourceName: 'SECOP',
            externalId: src.externalId,
            humanReference: src.humanReference,
            originalUrl: src.originalUrl,
          },
        });

        if (newOppResult.ok) {
          await this.repository.save(newOppResult.value);
          if (this.analysisQueue) {
            await this.analysisQueue.enqueueAnalysis(newOppResult.value.id);
          }
          counters.created++;
        } else {
          counters.skipped++;
        }
      } else {
        const changes = this.compareSourceWithStored(existing, src);
        if (changes.length > 0) {
          let updatedOpp: Opportunity = existing;
          for (const change of changes) {
            updatedOpp = withOpportunityChange(updatedOpp, change);
          }

          const moneyResult = createMoney(
            src.amount !== null && src.amount >= 0 ? src.amount : 0,
          );
          const amount = moneyResult.ok ? moneyResult.value : updatedOpp.amount;

          updatedOpp = {
            ...updatedOpp,
            title: src.title,
            description: src.description,
            amount,
            amountKnown: src.amount !== null,
            isCompetitive: src.isCompetitive,
            categoryCode: src.categoryCode,
            lastPublishedAt: src.lastPublishedAt,
            status: src.status !== 'Unknown' ? src.status : 'Amended',
            closingDate: src.closingDate,
            isOpenForSubmission: src.isOpenForSubmission,
          };

          await this.repository.save(updatedOpp);
          if (this.analysisQueue) {
            await this.analysisQueue.enqueueAnalysis(updatedOpp.id);
          }
          counters.updated++;
        }
      }
    }
  }

  private compareSourceWithStored(existing: Opportunity, src: SourceOpportunity): Change[] {
    const changes: Change[] = [];
    const now = new Date();

    const newClosing = src.closingDate ? src.closingDate.toISOString() : 'null';
    const oldClosing = existing.closingDate ? existing.closingDate.toISOString() : 'null';

    if (newClosing !== oldClosing) {
      changes.push({
        field: 'closingDate',
        previousValue: oldClosing,
        newValue: newClosing,
        detectedAt: now,
      });
    }

    if (src.status !== 'Unknown' && src.status !== existing.status) {
      changes.push({
        field: 'status',
        previousValue: existing.status,
        newValue: src.status,
        detectedAt: now,
      });
    }

    if (src.title !== existing.title) {
      changes.push({
        field: 'title',
        previousValue: existing.title,
        newValue: src.title,
        detectedAt: now,
      });
    }

    if (src.description !== existing.description) {
      changes.push({
        field: 'description',
        previousValue: existing.description,
        newValue: src.description,
        detectedAt: now,
      });
    }

    const oldAmount = existing.amountKnown ? String(existing.amount.amount) : 'null';
    const newAmount = src.amount !== null ? String(src.amount) : 'null';
    if (oldAmount !== newAmount) {
      changes.push({
        field: 'amount',
        previousValue: oldAmount,
        newValue: newAmount,
        detectedAt: now,
      });
    }

    return changes;
  }
}
