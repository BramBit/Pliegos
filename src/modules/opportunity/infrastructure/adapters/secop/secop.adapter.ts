import { randomUUID } from 'node:crypto';
import { Injectable, Logger, LoggerService } from '@nestjs/common';
import {
  OpportunitySourcePort,
  RawSecopProcess,
} from '../../../domain/ports/opportunity-source.port';
import {
  createOpportunity,
  Opportunity,
} from '../../../domain/entities/opportunity.entity';
import { OpportunityStatus } from '../../../domain/value-objects/opportunity.value-objects';
import { createMoney } from '../../../domain/value-objects/money.vo';
import { asOpportunityId, OpportunityId } from '../../../../shared/domain/typed-id';
import { Result } from '../../../../shared/domain/result';
import { ValidationError } from '../../../../shared/domain/errors';

export interface SecopAdapterOptions {
  readonly endpointUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly logger?: LoggerService;
}

export const DEFAULT_SECOP_ENDPOINT = 'https://www.datos.gov.co/resource/p6dx-8zbt.json';

@Injectable()
export class SecopAdapter implements OpportunitySourcePort {
  private readonly endpointUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly logger: LoggerService;

  constructor(options?: SecopAdapterOptions) {
    this.endpointUrl = options?.endpointUrl ?? DEFAULT_SECOP_ENDPOINT;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.logger = options?.logger ?? new Logger(SecopAdapter.name);
  }

  /**
   * Fetches latest opportunities from the SECOP II dataset.
   * If `since` is provided, filters via Socrata SoQL ($where).
   */
  async fetchLatest(since?: Date): Promise<RawSecopProcess[]> {
    const url = new URL(this.endpointUrl);

    if (since && !isNaN(since.getTime())) {
      url.searchParams.set('$where', `fecha_de_publicacion_del >= '${since.toISOString()}'`);
    }

    url.searchParams.set('$order', 'fecha_de_publicacion_del DESC');

    const response = await this.fetchFn(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch from SECOP endpoint (${this.endpointUrl}): HTTP ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as RawSecopProcess[];
  }

  /**
   * Maps a RawSecopProcess record to the domain Opportunity aggregate,
   * strictly adhering to technical design §1.2.
   */
  mapToOpportunity(raw: RawSecopProcess, id?: OpportunityId): Result<Opportunity, ValidationError> {
    const rawAmount = raw.precio_base ? parseFloat(raw.precio_base) : 0;
    const moneyResult = createMoney(Number.isFinite(rawAmount) && rawAmount >= 0 ? rawAmount : 0);
    const amount = moneyResult.ok ? moneyResult.value : { amount: 0, currency: 'COP' as const };

    const publishedAt = raw.fecha_de_publicacion_del
      ? new Date(raw.fecha_de_publicacion_del)
      : new Date();

    const closingDate = raw.fecha_de_recepcion_de
      ? new Date(raw.fecha_de_recepcion_de)
      : null;

    // Nested urlproceso.url unwrapping per technical design §1.2
    let originalUrl = '';
    if (raw.urlproceso && typeof raw.urlproceso === 'object' && typeof raw.urlproceso.url === 'string') {
      originalUrl = raw.urlproceso.url;
    }

    const status = this.mapStatus(raw.estado_del_procedimiento, raw.estado_resumen);

    return createOpportunity({
      id: id ?? asOpportunityId(randomUUID()),
      title: raw.nombre_del_procedimiento,
      contractingEntity: {
        name: raw.entidad,
        taxId: raw.nit_entidad,
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
      status,
      source: {
        sourceName: 'SECOP',
        externalId: raw.id_del_proceso,
        humanReference: raw.referencia_del_proceso || raw.id_del_proceso,
        originalUrl,
      },
    });
  }

  /**
   * Translates SECOP procedure statuses to the domain OpportunityStatus enum.
   * If a status is unmapped, logs a warning and falls back to 'Unknown'.
   */
  mapStatus(rawStatus?: string, rawResumen?: string): OpportunityStatus {
    const s = (rawStatus ?? '').trim().toLowerCase();
    const r = (rawResumen ?? '').trim().toLowerCase();

    if (!s && !r) {
      this.logger.warn('Empty SECOP status encountered; falling back to OpportunityStatus.Unknown.');
      return 'Unknown';
    }

    // 1. Evaluate primary procedure status (estado_del_procedimiento)
    if (s.includes('seleccionad') || s.includes('adjudicad')) return 'Awarded';
    if (s.includes('publicad') || s.includes('evaluaci')) return 'Published';
    if (s.includes('modificad') || s.includes('adenda')) return 'Amended';
    if (s.includes('cerrad')) return 'Closed';
    if (s.includes('cancelad') || s.includes('desiert')) return 'Cancelled';

    // 2. Evaluate summary status fallback (estado_resumen)
    if (r.includes('seleccionad') || r.includes('adjudicad')) return 'Awarded';
    if (r.includes('presentación de oferta') || r.includes('presentacion de oferta')) return 'Published';
    if (r.includes('modificad')) return 'Amended';
    if (r.includes('cerrad')) return 'Closed';
    if (r.includes('cancelad') || r.includes('desiert')) return 'Cancelled';

    // 3. Unmapped status: log warning and fallback to 'Unknown' per design §1.2 & §6
    this.logger.warn(
      `Unmapped SECOP status: "${rawStatus}" (resumen: "${rawResumen}"). Falling back to OpportunityStatus.Unknown.`,
    );

    return 'Unknown';
  }
}
