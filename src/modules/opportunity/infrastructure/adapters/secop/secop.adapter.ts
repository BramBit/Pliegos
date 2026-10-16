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
  /** Socrata page size ($limit). Default 1000. */
  readonly pageSize?: number;
  /** Optional Socrata app token (X-App-Token) to avoid anonymous throttling. */
  readonly appToken?: string;
  readonly maxRetries?: number;
  readonly retryBaseDelayMs?: number;
  readonly sleepFn?: (ms: number) => Promise<void>;
}

export interface FetchOptions {
  readonly pageSize?: number;
  readonly maxRecords?: number;
}

export const DEFAULT_SECOP_ENDPOINT = 'https://www.datos.gov.co/resource/p6dx-8zbt.json';

@Injectable()
export class SecopAdapter implements OpportunitySourcePort {
  private readonly endpointUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly logger: LoggerService;
  private readonly pageSize: number;
  private readonly appToken?: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options?: SecopAdapterOptions) {
    this.pageSize = options?.pageSize ?? (Number(process.env.SECOP_PAGE_SIZE) || 1000);
    this.appToken = options?.appToken ?? process.env.SECOP_APP_TOKEN;
    this.maxRetries = options?.maxRetries ?? 4;
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? 1000;
    this.sleepFn = options?.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.endpointUrl = options?.endpointUrl ?? DEFAULT_SECOP_ENDPOINT;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.logger = options?.logger ?? new Logger(SecopAdapter.name);
  }

  /**
   * Fetches latest opportunities from the SECOP II dataset, paginating through Socrata
   * until `maxRecords` is reached (default: all pages). Prefer `fetchPages` for large loads
   * to avoid holding every record in memory.
   */
  async fetchLatest(since?: Date, options?: FetchOptions): Promise<RawSecopProcess[]> {
    const all: RawSecopProcess[] = [];
    for await (const page of this.fetchPages(since, options)) {
      all.push(...page);
    }
    return all;
  }

  /**
   * Streams SECOP II records page by page using Socrata `$limit`/`$offset` with a
   * deterministic ordering (publication date + process id) so pages never overlap.
   * Each page request is retried with exponential backoff on HTTP 429/5xx and network errors.
   */
  async *fetchPages(since?: Date, options?: FetchOptions): AsyncGenerator<RawSecopProcess[]> {
    const pageSize = options?.pageSize ?? this.pageSize;
    const maxRecords = options?.maxRecords ?? Number.POSITIVE_INFINITY;
    let offset = 0;

    while (offset < maxRecords) {
      const limit = Math.min(pageSize, maxRecords - offset);
      const page = await this.fetchPage(since, limit, offset);
      if (page.length === 0) return;

      yield page;
      offset += page.length;
      if (page.length < limit) return;
    }
  }

  private async fetchPage(
    since: Date | undefined,
    limit: number,
    offset: number,
  ): Promise<RawSecopProcess[]> {
    const url = new URL(this.endpointUrl);

    const clauses: string[] = [];

    if (since && !isNaN(since.getTime())) {
      // Socrata's floating_timestamp SoQL type requires ISO format without timezone 'Z'
      const soqlDate = since.toISOString().replace(/Z$/, '');
      clauses.push(`fecha_de_publicacion_del >= '${soqlDate}'`);
    }

    if (clauses.length > 0) {
      url.searchParams.set('$where', clauses.join(' AND '));
    }
    url.searchParams.set('$order', 'fecha_de_publicacion_del DESC, id_del_proceso ASC');
    url.searchParams.set('$limit', String(limit));
    url.searchParams.set('$offset', String(offset));

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.appToken) {
      headers['X-App-Token'] = this.appToken;
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let retryAfterMs: number | undefined;
      try {
        const response = await this.fetchFn(url.toString(), { method: 'GET', headers });

        if (response.ok) {
          return (await response.json()) as RawSecopProcess[];
        }

        lastError = new Error(
          `Failed to fetch from SECOP endpoint (${this.endpointUrl}): HTTP ${response.status} ${response.statusText}`,
        );
        const retriable = response.status === 429 || response.status >= 500;
        if (!retriable) throw lastError;

        const retryAfter = Number(response.headers?.get?.('Retry-After'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) retryAfterMs = retryAfter * 1000;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Non-retriable HTTP errors were thrown above with an "HTTP 4xx" message
        if (/HTTP 4\d\d/.test(lastError.message) && !/HTTP 429/.test(lastError.message)) {
          throw lastError;
        }
      }

      if (attempt < this.maxRetries) {
        const delay = retryAfterMs ?? this.retryBaseDelayMs * 2 ** attempt;
        this.logger.warn(
          `SECOP page offset=${offset} failed (${lastError?.message}); retry ${attempt + 1}/${this.maxRetries} in ${delay}ms`,
        );
        await this.sleepFn(delay);
      }
    }

    throw lastError ?? new Error('Failed to fetch from SECOP endpoint');
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
