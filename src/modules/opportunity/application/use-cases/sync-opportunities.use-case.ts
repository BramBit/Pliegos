import { randomUUID } from 'node:crypto';
import { Result, ok, err } from '../../../shared/domain/result';
import {
  SourceUnavailableError,
  createSourceUnavailableError,
} from '../../../shared/domain/errors';
import { asOpportunityId } from '../../../shared/domain/typed-id';
import {
  OpportunitySourcePort,
  RawSecopProcess,
} from '../../domain/ports/opportunity-source.port';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { AnalysisQueuePort } from '../../domain/ports/analysis-queue.port';
import {
  createOpportunity,
  withOpportunityChange,
  Opportunity,
} from '../../domain/entities/opportunity.entity';
import {
  OpportunityStatus,
  Change,
} from '../../domain/value-objects/opportunity.value-objects';
import { createMoney } from '../../domain/value-objects/money.vo';

export interface ISyncOpportunitiesUseCase {
  execute(input: {
    since?: Date;
    maxRecords?: number;
  }): Promise<Result<{ created: number; updated: number }, SourceUnavailableError>>;
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
  }): Promise<Result<{ created: number; updated: number }, SourceUnavailableError>> {
    const counters = { created: 0, updated: 0 };
    const fetchOptions = { maxRecords: input.maxRecords };

    try {
      if (this.source.fetchPages) {
        for await (const page of this.source.fetchPages(input.since, fetchOptions)) {
          await this.processPage(page, counters);
        }
      } else {
        const rawProcesses: RawSecopProcess[] = await this.source.fetchLatest(
          input.since,
          fetchOptions,
        );
        await this.processPage(rawProcesses, counters);
      }
    } catch {
      return err(createSourceUnavailableError('SECOP'));
    }

    return ok(counters);
  }

  private async processPage(
    rawProcesses: RawSecopProcess[],
    counters: { created: number; updated: number },
  ): Promise<void> {
    for (const raw of rawProcesses) {
      const existing = await this.repository.findByExternalId(raw.id_del_proceso);

      if (!existing) {
        const newOppResult = this.mapToOpportunity(raw);
        if (newOppResult.ok) {
          await this.repository.save(newOppResult.value);
          if (this.analysisQueue) {
            await this.analysisQueue.enqueueAnalysis(newOppResult.value.id);
          }
          counters.created++;
        }
      } else {
        const changes = this.detectDiff(existing, raw);
        if (changes.length > 0) {
          let updatedOpp: Opportunity = existing;
          for (const change of changes) {
            updatedOpp = withOpportunityChange(updatedOpp, change);
          }

          // Apply latest status or closingDate updates
          const mappedStatus = this.mapStatus(raw.estado_del_procedimiento);
          const mappedClosingDate = raw.fecha_de_recepcion_de
            ? new Date(raw.fecha_de_recepcion_de)
            : null;

          updatedOpp = {
            ...updatedOpp,
            status: mappedStatus !== 'Unknown' ? mappedStatus : 'Amended',
            closingDate: mappedClosingDate,
            isOpenForSubmission: raw.estado_de_apertura_del_proceso === 'Abierto',
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

  private mapToOpportunity(raw: RawSecopProcess): Result<Opportunity, unknown> {
    const rawAmount = raw.precio_base ? parseFloat(raw.precio_base) : 0;
    const moneyResult = createMoney(Number.isFinite(rawAmount) && rawAmount >= 0 ? rawAmount : 0);
    const amount = moneyResult.ok ? moneyResult.value : { amount: 0, currency: 'COP' as const };

    const publishedAt = raw.fecha_de_publicacion_del
      ? new Date(raw.fecha_de_publicacion_del)
      : new Date();

    const closingDate = raw.fecha_de_recepcion_de
      ? new Date(raw.fecha_de_recepcion_de)
      : null;

    return createOpportunity({
      id: asOpportunityId(randomUUID()),
      title: raw.nombre_del_procedimiento || 'Sin título',
      contractingEntity: {
        name: raw.entidad || 'Entidad no especificada',
        taxId: raw.nit_entidad || 'N/A',
      },
      location: {
        city: raw.ciudad_entidad ?? null,
        department: raw.departamento_entidad ?? null,
      },
      amount,
      contractType: raw.tipo_de_contrato || 'Otros',
      procurementModality: raw.modalidad_de_contratacion || 'Otros',
      categoryCode: raw.codigo_principal_de_categoria || 'V1.00000000',
      publishedAt: isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
      closingDate: closingDate && !isNaN(closingDate.getTime()) ? closingDate : null,
      isOpenForSubmission: raw.estado_de_apertura_del_proceso === 'Abierto',
      status: this.mapStatus(raw.estado_del_procedimiento),
      source: {
        sourceName: 'SECOP',
        externalId: raw.id_del_proceso,
        humanReference: raw.referencia_del_proceso || raw.id_del_proceso,
        originalUrl: raw.urlproceso?.url || '',
      },
    });
  }

  private detectDiff(existing: Opportunity, raw: RawSecopProcess): Change[] {
    const changes: Change[] = [];
    const now = new Date();

    const newClosing = raw.fecha_de_recepcion_de
      ? new Date(raw.fecha_de_recepcion_de).toISOString()
      : 'null';
    const oldClosing = existing.closingDate ? existing.closingDate.toISOString() : 'null';

    if (newClosing !== oldClosing) {
      changes.push({
        field: 'closingDate',
        previousValue: oldClosing,
        newValue: newClosing,
        detectedAt: now,
      });
    }

    const newStatus = this.mapStatus(raw.estado_del_procedimiento);
    if (newStatus !== 'Unknown' && newStatus !== existing.status) {
      changes.push({
        field: 'status',
        previousValue: existing.status,
        newValue: newStatus,
        detectedAt: now,
      });
    }

    return changes;
  }

  private mapStatus(rawStatus?: string): OpportunityStatus {
    if (!rawStatus) return 'Unknown';
    const normalized = rawStatus.trim().toLowerCase();

    if (normalized.includes('publicad') || normalized.includes('evaluaci')) return 'Published';
    if (normalized.includes('modificad') || normalized.includes('adenda')) return 'Amended';
    if (normalized.includes('cerrad')) return 'Closed';
    if (normalized.includes('adjudicad') || normalized.includes('seleccionad')) return 'Awarded';
    if (normalized.includes('cancelad') || normalized.includes('desiert')) return 'Cancelled';

    return 'Unknown';
  }
}
