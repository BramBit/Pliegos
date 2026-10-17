import { randomUUID } from 'node:crypto';
import { Injectable, Logger, LoggerService } from '@nestjs/common';
import {
  OpportunitySourcePort,
  SourceFetchOptions,
  SourceOpportunity,
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
import {
  isCompetitive,
  normalizeUnspsc,
  nullIfPlaceholder,
  parseAmount,
} from './normalizers';

export interface RawSecopProcess {
  readonly id_del_proceso: string;
  readonly referencia_del_proceso?: string;
  readonly nombre_del_procedimiento: string;
  readonly descripci_n_del_procedimiento?: string;
  readonly entidad: string;
  readonly nit_entidad?: string;
  readonly ciudad_entidad?: string;
  readonly departamento_entidad?: string;
  readonly precio_base?: string | number;
  readonly tipo_de_contrato?: string;
  readonly modalidad_de_contratacion?: string;
  readonly estado_del_procedimiento?: string;
  readonly estado_resumen?: string;
  readonly estado_de_apertura_del_proceso?: 'Abierto' | 'Cerrado';
  readonly fecha_de_publicacion_del?: string;
  readonly fecha_de_ultima_publicaci?: string;
  readonly fecha_de_recepcion_de?: string;
  readonly fecha_de_apertura_de_respuesta?: string;
  readonly codigo_principal_de_categoria?: string;
  readonly urlproceso?: { url?: string };
  readonly proveedores_invitados?: string;
  readonly respuestas_al_procedimiento?: string;
}

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

export type FetchOptions = SourceFetchOptions;

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
   * Fetches latest mapped opportunities from the SECOP II dataset, paginating through Socrata
   * until `maxRecords` is reached (default: all pages).
   */
  async fetchLatest(since?: Date, options?: FetchOptions): Promise<SourceOpportunity[]> {
    const all: SourceOpportunity[] = [];
    for await (const page of this.fetchPages(since, options)) {
      all.push(...page);
    }
    return all;
  }

  /**
   * Streams normalized SourceOpportunity pages from SECOP II using Socrata `$limit`/`$offset`.
   * Records without a valid `fecha_de_publicacion_del` are skipped and counted via `options.onSkipped`.
   */
  async *fetchPages(since?: Date, options?: FetchOptions): AsyncGenerator<SourceOpportunity[]> {
    const pageSize = options?.pageSize ?? this.pageSize;
    const maxRecords = options?.maxRecords ?? Number.POSITIVE_INFINITY;
    let offset = 0;

    while (offset < maxRecords) {
      const limit = Math.min(pageSize, maxRecords - offset);
      const rawPage = await this.fetchPage(since, limit, offset, options);
      if (rawPage.length === 0) return;

      const mappedPage: SourceOpportunity[] = [];
      for (const raw of rawPage) {
        const mapped = this.mapToSourceOpportunity(raw, options?.now);
        if (!mapped) {
          options?.onSkipped?.();
          continue;
        }
        if (mapped.status === 'Unknown') {
          const rawLabel =
            (raw.estado_del_procedimiento ?? raw.estado_resumen ?? '').trim() || '(empty)';
          options?.onUnknownStatus?.(rawLabel);
        }
        mappedPage.push(mapped);
      }

      yield mappedPage;
      offset += rawPage.length;
      if (rawPage.length < limit) return;
    }
  }

  private async fetchPage(
    since: Date | undefined,
    limit: number,
    offset: number,
    options?: FetchOptions,
  ): Promise<RawSecopProcess[]> {
    const url = new URL(this.endpointUrl);

    const clauses: string[] = [];

    if (options?.mode === 'openCompetitive') {
      const refNow = options.now && !isNaN(options.now.getTime()) ? options.now : new Date();
      const soqlNow = refNow.toISOString().replace(/Z$/, '');
      clauses.push(`estado_del_procedimiento in ('Publicado','Abierto','Evaluación')`);
      clauses.push(`fecha_de_recepcion_de > '${soqlNow}'`);
    } else if (since && !isNaN(since.getTime())) {
      // Socrata's floating_timestamp SoQL type requires ISO format without timezone 'Z'
      const soqlDate = since.toISOString().replace(/Z$/, '');
      clauses.push(`fecha_de_ultima_publicaci >= '${soqlDate}'`);
    }

    if (clauses.length > 0) {
      url.searchParams.set('$where', clauses.join(' AND '));
    }
    url.searchParams.set('$order', 'fecha_de_ultima_publicaci ASC, id_del_proceso ASC');
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
   * Maps a RawSecopProcess to a normalized SourceOpportunity.
   * Returns null if `fecha_de_publicacion_del` is absent or invalid (never invents `new Date()`).
   */
  mapToSourceOpportunity(raw: RawSecopProcess, now: Date = new Date()): SourceOpportunity | null {
    if (!raw.fecha_de_publicacion_del || raw.fecha_de_publicacion_del.trim() === '') {
      this.logger.warn(
        `Skipping SECOP record "${raw.id_del_proceso ?? ''}": missing fecha_de_publicacion_del.`,
      );
      return null;
    }

    const publishedAt = new Date(raw.fecha_de_publicacion_del);
    if (isNaN(publishedAt.getTime())) {
      this.logger.warn(
        `Skipping SECOP record "${raw.id_del_proceso ?? ''}": invalid fecha_de_publicacion_del "${raw.fecha_de_publicacion_del}".`,
      );
      return null;
    }

    let lastPublishedAt = publishedAt;
    if (raw.fecha_de_ultima_publicaci && raw.fecha_de_ultima_publicaci.trim() !== '') {
      const parsedLast = new Date(raw.fecha_de_ultima_publicaci);
      if (!isNaN(parsedLast.getTime())) {
        lastPublishedAt = parsedLast;
      }
    }

    let closingDate: Date | null = null;
    if (raw.fecha_de_recepcion_de && raw.fecha_de_recepcion_de.trim() !== '') {
      const parsedClosing = new Date(raw.fecha_de_recepcion_de);
      if (!isNaN(parsedClosing.getTime())) {
        closingDate = parsedClosing;
      }
    }

    const parsedAmount = parseAmount(raw.precio_base);
    const amount = parsedAmount !== null && parsedAmount >= 0 ? parsedAmount : null;

    let originalUrl = '';
    if (raw.urlproceso && typeof raw.urlproceso === 'object' && typeof raw.urlproceso.url === 'string') {
      originalUrl = raw.urlproceso.url;
    }

    const status = this.mapStatus(raw.estado_del_procedimiento, raw.estado_resumen);
    const isOpenForSubmission = SecopAdapter.computeIsOpenForSubmission(status, closingDate, now);

    const externalId = (raw.id_del_proceso ?? '').trim();
    const humanReference = nullIfPlaceholder(raw.referencia_del_proceso) ?? externalId;

    return {
      externalId,
      humanReference,
      title: (raw.nombre_del_procedimiento ?? '').trim(),
      description: nullIfPlaceholder(raw.descripci_n_del_procedimiento) ?? '',
      entityName: (raw.entidad ?? '').trim(),
      entityTaxId: nullIfPlaceholder(raw.nit_entidad) ?? '',
      city: nullIfPlaceholder(raw.ciudad_entidad),
      department: nullIfPlaceholder(raw.departamento_entidad),
      amount,
      contractType: nullIfPlaceholder(raw.tipo_de_contrato) ?? 'Otros',
      procurementModality: nullIfPlaceholder(raw.modalidad_de_contratacion) ?? 'Otros',
      isCompetitive: isCompetitive(raw.modalidad_de_contratacion),
      categoryCode: normalizeUnspsc(raw.codigo_principal_de_categoria),
      publishedAt,
      lastPublishedAt,
      closingDate,
      isOpenForSubmission,
      status,
      originalUrl,
    };
  }

  /**
   * Maps a RawSecopProcess record to the domain Opportunity aggregate using the P1.2 normalizers.
   * Never invents `new Date()`: if `fecha_de_publicacion_del` is missing, validation fails on `publishedAt`.
   */
  mapToOpportunity(
    raw: RawSecopProcess,
    id?: OpportunityId,
    now: Date = new Date(),
  ): Result<Opportunity, ValidationError> {
    const sourceOpp = this.mapToSourceOpportunity(raw, now);

    const publishedAt = sourceOpp ? sourceOpp.publishedAt : new Date(NaN);
    const lastPublishedAt = sourceOpp ? sourceOpp.lastPublishedAt : publishedAt;

    let closingDate: Date | null = null;
    if (sourceOpp) {
      closingDate = sourceOpp.closingDate;
    } else if (raw.fecha_de_recepcion_de && raw.fecha_de_recepcion_de.trim() !== '') {
      const parsed = new Date(raw.fecha_de_recepcion_de);
      closingDate = !isNaN(parsed.getTime()) ? parsed : null;
    }

    const parsedAmount = sourceOpp ? sourceOpp.amount : parseAmount(raw.precio_base);
    const validAmount = parsedAmount !== null && parsedAmount >= 0 ? parsedAmount : null;
    const moneyResult = createMoney(validAmount ?? 0);
    const amount = moneyResult.ok ? moneyResult.value : { amount: 0, currency: 'COP' as const };

    let originalUrl = '';
    if (raw.urlproceso && typeof raw.urlproceso === 'object' && typeof raw.urlproceso.url === 'string') {
      originalUrl = raw.urlproceso.url;
    }

    const status = sourceOpp
      ? sourceOpp.status
      : this.mapStatus(raw.estado_del_procedimiento, raw.estado_resumen);
    const isOpenForSubmission = SecopAdapter.computeIsOpenForSubmission(status, closingDate, now);
    const externalId = (raw.id_del_proceso ?? '').trim();

    return createOpportunity({
      id: id ?? asOpportunityId(randomUUID()),
      title: (raw.nombre_del_procedimiento ?? '').trim(),
      description: nullIfPlaceholder(raw.descripci_n_del_procedimiento) ?? '',
      contractingEntity: {
        name: (raw.entidad ?? '').trim(),
        taxId: nullIfPlaceholder(raw.nit_entidad) ?? '',
      },
      location: {
        city: nullIfPlaceholder(raw.ciudad_entidad),
        department: nullIfPlaceholder(raw.departamento_entidad),
      },
      amount,
      amountKnown: validAmount !== null,
      contractType: nullIfPlaceholder(raw.tipo_de_contrato) ?? 'Otros',
      procurementModality: nullIfPlaceholder(raw.modalidad_de_contratacion) ?? 'Otros',
      isCompetitive: isCompetitive(raw.modalidad_de_contratacion),
      categoryCode: normalizeUnspsc(raw.codigo_principal_de_categoria),
      publishedAt,
      lastPublishedAt,
      closingDate,
      isOpenForSubmission,
      status,
      source: {
        sourceName: 'SECOP',
        externalId,
        humanReference: nullIfPlaceholder(raw.referencia_del_proceso) ?? externalId,
        originalUrl,
      },
    });
  }

  /**
   * Derives `isOpenForSubmission` from `status` and `closingDate` instead of
   * `estado_de_apertura_del_proceso`.
   */
  static computeIsOpenForSubmission(
    status: OpportunityStatus,
    closingDate: Date | null,
    now: Date = new Date(),
  ): boolean {
    if (status !== 'Published' && status !== 'Amended') {
      return false;
    }
    return closingDate === null || closingDate.getTime() >= now.getTime();
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
    if (s.includes('borrador') || s.includes('en aprobaci') || s.includes('suspendid')) {
      return 'Draft';
    }
    if (s.includes('seleccionad') || s.includes('adjudicad')) return 'Awarded';
    if (
      s.includes('publicad') ||
      s.includes('evaluaci') ||
      s.includes('abiert') ||
      s.includes('aprobad')
    ) {
      return 'Published';
    }
    if (s.includes('modificad') || s.includes('adenda')) return 'Amended';
    if (s.includes('cerrad')) return 'Closed';
    if (s.includes('cancelad') || s.includes('desiert')) return 'Cancelled';

    // 2. Evaluate summary status fallback (estado_resumen)
    if (r.includes('borrador') || r.includes('en aprobaci') || r.includes('suspendid')) {
      return 'Draft';
    }
    if (r.includes('seleccionad') || r.includes('adjudicad')) return 'Awarded';
    if (
      r.includes('presentación de oferta') ||
      r.includes('presentacion de oferta') ||
      r.includes('publicad') ||
      r.includes('abiert') ||
      r.includes('aprobad')
    ) {
      return 'Published';
    }
    if (r.includes('modificad') || r.includes('adenda')) return 'Amended';
    if (r.includes('cerrad')) return 'Closed';
    if (r.includes('cancelad') || r.includes('desiert')) return 'Cancelled';

    // 3. Unmapped status: log warning and fallback to 'Unknown' per design §1.2 & §6
    this.logger.warn(
      `Unmapped SECOP status: "${rawStatus}" (resumen: "${rawResumen}"). Falling back to OpportunityStatus.Unknown.`,
    );

    return 'Unknown';
  }
}
