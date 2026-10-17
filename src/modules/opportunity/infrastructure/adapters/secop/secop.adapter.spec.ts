import * as fs from 'node:fs';
import * as path from 'node:path';
import { LoggerService } from '@nestjs/common';
import { SecopAdapter, DEFAULT_SECOP_ENDPOINT, RawSecopProcess } from './secop.adapter';
import { asOpportunityId } from '../../../../shared/domain/typed-id';

describe('SecopAdapter', () => {
  let sampleFixture: RawSecopProcess[];
  let fakeLogger: LoggerService & { warnings: string[] };

  beforeAll(() => {
    const fixturePath = path.join(__dirname, 'fixtures', 'secop-sample.fixture.json');
    const rawData = fs.readFileSync(fixturePath, 'utf8');
    sampleFixture = JSON.parse(rawData) as RawSecopProcess[];
  });

  beforeEach(() => {
    fakeLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn((msg: string) => {
        fakeLogger.warnings.push(msg);
      }),
      debug: jest.fn(),
      verbose: jest.fn(),
      warnings: [],
    };
  });

  describe('fetchLatest / fetchPages (network / endpoint abstraction)', () => {
    it('calls default endpoint and returns mapped SourceOpportunity items', async () => {
      let calledUrl = '';
      const mockFetch: typeof fetch = jest.fn(async (url: string | URL | Request) => {
        calledUrl = url.toString();
        return {
          ok: true,
          status: 200,
          json: async () => sampleFixture,
        } as Response;
      });

      const adapter = new SecopAdapter({
        fetchFn: mockFetch,
        logger: fakeLogger,
      });

      const result = await adapter.fetchLatest();

      const parsedUrl = new URL(calledUrl);
      expect(parsedUrl.origin + parsedUrl.pathname).toBe(DEFAULT_SECOP_ENDPOINT);
      expect(parsedUrl.searchParams.get('$order')).toBe('fecha_de_ultima_publicaci ASC, id_del_proceso ASC');
      expect(parsedUrl.searchParams.get('$where')).toBeNull();
      expect(result).toHaveLength(sampleFixture.length);
      expect(result[0].externalId).toBe('CO1.REQ.7128715');
    });

    it('adds SoQL $where clause on fecha_de_ultima_publicaci when since Date is provided', async () => {
      let calledUrl = '';
      const mockFetch: typeof fetch = jest.fn(async (url: string | URL | Request) => {
        calledUrl = url.toString();
        return {
          ok: true,
          status: 200,
          json: async () => sampleFixture,
        } as Response;
      });

      const adapter = new SecopAdapter({
        fetchFn: mockFetch,
        logger: fakeLogger,
      });

      const since = new Date('2026-01-01T00:00:00.000Z');
      await adapter.fetchLatest(since);

      const parsedUrl = new URL(calledUrl);
      const expectedSoqlDate = since.toISOString().replace(/Z$/, '');
      expect(parsedUrl.searchParams.get('$where')).toBe(`fecha_de_ultima_publicaci >= '${expectedSoqlDate}'`);
      expect(parsedUrl.searchParams.get('$order')).toBe('fecha_de_ultima_publicaci ASC, id_del_proceso ASC');
    });

    it('uses openCompetitive $where clause when mode is openCompetitive', async () => {
      let calledUrl = '';
      const mockFetch: typeof fetch = jest.fn(async (url: string | URL | Request) => {
        calledUrl = url.toString();
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      });

      const adapter = new SecopAdapter({
        fetchFn: mockFetch,
        logger: fakeLogger,
      });

      const now = new Date('2026-10-17T12:00:00.000Z');
      await adapter.fetchLatest(undefined, { mode: 'openCompetitive', now });

      const parsedUrl = new URL(calledUrl);
      expect(parsedUrl.searchParams.get('$where')).toBe(
        `estado_del_procedimiento in ('Publicado','Abierto','Evaluación') AND fecha_de_recepcion_de > '2026-10-17T12:00:00.000'`,
      );
      expect(parsedUrl.searchParams.get('$order')).toBe('fecha_de_ultima_publicaci ASC, id_del_proceso ASC');
    });

    it('skips records without fecha_de_publicacion_del and invokes onSkipped', async () => {
      const mockFetch: typeof fetch = jest.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => [
            sampleFixture[0],
            { ...sampleFixture[1], id_del_proceso: 'NO-DATE-1', fecha_de_publicacion_del: undefined },
            { ...sampleFixture[2], id_del_proceso: 'NO-DATE-2', fecha_de_publicacion_del: '' },
          ],
        } as Response;
      });

      const adapter = new SecopAdapter({ fetchFn: mockFetch, logger: fakeLogger });
      let skipped = 0;
      const result = await adapter.fetchLatest(undefined, {
        onSkipped: () => {
          skipped++;
        },
      });

      expect(result).toHaveLength(1);
      expect(result[0].externalId).toBe('CO1.REQ.7128715');
      expect(skipped).toBe(2);
    });

    it('throws error when SECOP endpoint returns non-200 HTTP status', async () => {
      const mockFetch: typeof fetch = jest.fn(async () => {
        return {
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        } as Response;
      });

      const adapter = new SecopAdapter({
        fetchFn: mockFetch,
        logger: fakeLogger,
        sleepFn: async () => undefined,
      });

      await expect(adapter.fetchLatest()).rejects.toThrow(
        'Failed to fetch from SECOP endpoint (https://www.datos.gov.co/resource/p6dx-8zbt.json): HTTP 503 Service Unavailable',
      );
    });
  });

  describe('pagination and resilience', () => {
    const makePage = (n: number, start = 0) =>
      Array.from({ length: n }, (_, i) => ({ ...sampleFixture[0], id_del_proceso: `P${start + i}` }));

    it('paginates with $limit/$offset until a short page is returned', async () => {
      const urls: URL[] = [];
      const pages = [makePage(3, 0), makePage(3, 3), makePage(1, 6)];
      const mockFetch: typeof fetch = jest.fn(async (url: string | URL | Request) => {
        urls.push(new URL(url.toString()));
        return { ok: true, status: 200, json: async () => pages[urls.length - 1] } as Response;
      });
      const adapter = new SecopAdapter({ fetchFn: mockFetch, logger: fakeLogger, pageSize: 3 });

      const result = await adapter.fetchLatest();

      expect(result).toHaveLength(7);
      expect(urls.map((u) => u.searchParams.get('$offset'))).toEqual(['0', '3', '6']);
      expect(urls.every((u) => u.searchParams.get('$limit') === '3')).toBe(true);
    });

    it('stops at maxRecords and trims the last page limit', async () => {
      const urls: URL[] = [];
      const mockFetch: typeof fetch = jest.fn(async (url: string | URL | Request) => {
        const u = new URL(url.toString());
        urls.push(u);
        return {
          ok: true,
          status: 200,
          json: async () => makePage(Number(u.searchParams.get('$limit'))),
        } as Response;
      });
      const adapter = new SecopAdapter({ fetchFn: mockFetch, logger: fakeLogger, pageSize: 3 });

      const result = await adapter.fetchLatest(undefined, { maxRecords: 5 });

      expect(result).toHaveLength(5);
      expect(urls.map((u) => u.searchParams.get('$limit'))).toEqual(['3', '2']);
    });

    it('retries on HTTP 429 and 5xx with backoff, then succeeds', async () => {
      const sleeps: number[] = [];
      let calls = 0;
      const mockFetch: typeof fetch = jest.fn(async () => {
        calls++;
        if (calls === 1) return { ok: false, status: 429, statusText: 'Too Many Requests' } as Response;
        if (calls === 2) return { ok: false, status: 503, statusText: 'Unavailable' } as Response;
        return { ok: true, status: 200, json: async () => makePage(1) } as Response;
      });
      const adapter = new SecopAdapter({
        fetchFn: mockFetch,
        logger: fakeLogger,
        retryBaseDelayMs: 100,
        sleepFn: async (ms) => {
          sleeps.push(ms);
        },
      });

      const result = await adapter.fetchLatest();

      expect(result).toHaveLength(1);
      expect(sleeps).toEqual([100, 200]);
    });

    it('does not retry non-retriable HTTP 4xx errors', async () => {
      const mockFetch: typeof fetch = jest.fn(async () => {
        return { ok: false, status: 400, statusText: 'Bad Request' } as Response;
      });
      const adapter = new SecopAdapter({
        fetchFn: mockFetch,
        logger: fakeLogger,
        sleepFn: async () => undefined,
      });

      await expect(adapter.fetchLatest()).rejects.toThrow('HTTP 400');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('sends the Socrata app token header when configured', async () => {
      let headers: Record<string, string> = {};
      const mockFetch: typeof fetch = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        headers = init?.headers as Record<string, string>;
        return { ok: true, status: 200, json: async () => [] } as Response;
      });
      const adapter = new SecopAdapter({ fetchFn: mockFetch, logger: fakeLogger, appToken: 'tok' });

      await adapter.fetchLatest();

      expect(headers['X-App-Token']).toBe('tok');
    });
  });

  describe('mapToOpportunity & mapToSourceOpportunity', () => {
    let adapter: SecopAdapter;

    beforeEach(() => {
      adapter = new SecopAdapter({ logger: fakeLogger });
    });

    it('maps competitive process, carries description, normalizes placeholder city to null, strips V1. from UNSPSC, and derives isOpenForSubmission', () => {
      const raw = sampleFixture[0]; // CO1.REQ.7128715
      const now = new Date('2024-11-10T00:00:00.000'); // before closingDate 2024-11-12
      const result = adapter.mapToOpportunity(raw, asOpportunityId('opp-test-1'), now);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const opp = result.value;
      expect(opp.id).toBe('opp-test-1');
      expect(opp.title).toBe('SUMINISTRO ELECTROBOMBAS');
      expect(opp.description).toBe(
        'COMPRA ELECTROBOMBAS DE SUPERFICIE CENTRIFUGA MODELO PEARL C2P 55H36S , CON POTENCIA DE 5,5 HP, 220/440V Y TRIFASICAS SEDE A COLEGIO GABRIEL BETANCOURT MEJIA IED',
      );
      expect(opp.contractingEntity).toEqual({
        name: 'COLEGIO GABRIEL BETANCOURT MEJIA I.E.D',
        taxId: '900143276',
      });
      // Placeholder city 'No Definido' becomes null
      expect(opp.location).toEqual({
        city: null,
        department: 'Distrito Capital de Bogotá',
      });
      expect(opp.amount).toEqual({
        amount: 5500000,
        currency: 'COP',
      });
      expect(opp.amountKnown).toBe(true);
      expect(opp.contractType).toBe('Otro');
      expect(opp.procurementModality).toBe('Contratación régimen especial (con ofertas)');
      expect(opp.isCompetitive).toBe(true);
      expect(opp.categoryCode).toBe('40151500');
      expect(opp.publishedAt).toEqual(new Date('2024-11-06T00:00:00.000'));
      expect(opp.lastPublishedAt).toEqual(new Date('2024-11-06T00:00:00.000'));
      expect(opp.closingDate).toEqual(new Date('2024-11-12T00:00:00.000'));
      expect(opp.status).toBe('Published'); // 'Evaluación'
      // Derived from status ('Published') + closingDate >= now, ignoring estado_de_apertura_del_proceso ('Cerrado')
      expect(opp.isOpenForSubmission).toBe(true);
      expect(opp.source).toEqual({
        sourceName: 'SECOP',
        externalId: 'CO1.REQ.7128715',
        humanReference: 'RE-CGBM-049-2024',
        originalUrl: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.7008964',
      });

      // After closingDate has passed, isOpenForSubmission becomes false
      const afterClose = adapter.mapToOpportunity(
        raw,
        asOpportunityId('opp-test-1'),
        new Date('2024-11-13T00:00:00.000'),
      );
      expect(afterClose.ok && afterClose.value.isOpenForSubmission).toBe(false);
    });

    it('maps direct contracting process with isCompetitive=false, null closingDate, and isOpenForSubmission=false when Awarded', () => {
      const raw = sampleFixture[1]; // CO1.REQ.9845111 - Contratación directa, Seleccionado
      const result = adapter.mapToOpportunity(raw);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const opp = result.value;
      expect(opp.procurementModality).toBe('Contratación directa');
      expect(opp.isCompetitive).toBe(false);
      expect(opp.closingDate).toBeNull();
      expect(opp.contractingEntity.name).toBe('INVIAS');
      expect(opp.contractingEntity.taxId).toBe('800215807');
      expect(opp.amount.amount).toBe(48620250);
      expect(opp.amountKnown).toBe(true);
      expect(opp.status).toBe('Awarded'); // 'Seleccionado'
      // Even though estado_de_apertura_del_proceso is 'Abierto', status is 'Awarded' -> not open
      expect(opp.isOpenForSubmission).toBe(false);
      expect(opp.source.originalUrl).toBe(
        'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.9690232',
      );
    });

    it('sets amountKnown=false and amount=0 when precio_base is missing or empty', () => {
      const rawWithoutPrice: RawSecopProcess = {
        ...sampleFixture[0],
        precio_base: undefined,
      };
      const result = adapter.mapToOpportunity(rawWithoutPrice);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.amountKnown).toBe(false);
      expect(result.value.amount.amount).toBe(0);
    });

    it('maps reverse auction process with awarded summary', () => {
      const raw = sampleFixture[2]; // CO1.REQ.10373575
      const result = adapter.mapToOpportunity(raw);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const opp = result.value;
      expect(opp.title).toBe('(HIDRO-147) PRESTAR EL SERVICIO DE TRANSPORTE INTEGRAL');
      expect(opp.closingDate).toEqual(new Date('2026-04-30T00:00:00.000'));
      expect(opp.status).toBe('Awarded');
      expect(opp.isCompetitive).toBe(true);
      expect(opp.amount.amount).toBe(2214931820);
    });

    it('maps published regime special process (without offers) with isCompetitive=false and open submission', () => {
      const raw = sampleFixture[3]; // CO1.REQ.10388845
      const result = adapter.mapToOpportunity(raw);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const opp = result.value;
      expect(opp.status).toBe('Published');
      expect(opp.isCompetitive).toBe(false);
      expect(opp.isOpenForSubmission).toBe(true);
      expect(opp.closingDate).toBeNull();
    });

    it('falls back to OpportunityStatus.Unknown and logs a warning for unmapped status', () => {
      const raw = sampleFixture[4]; // CO1.REQ.9999999 - EstadoIneditoNoMapeado
      const result = adapter.mapToOpportunity(raw);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const opp = result.value;
      expect(opp.status).toBe('Unknown');
      expect(opp.isOpenForSubmission).toBe(false);

      expect(fakeLogger.warn).toHaveBeenCalled();
      const warningFound = fakeLogger.warnings.some((w) =>
        w.includes('Unmapped SECOP status: "EstadoIneditoNoMapeado"'),
      );
      expect(warningFound).toBe(true);
    });

    it('returns ValidationError if required domain fields or fecha_de_publicacion_del are missing (never invents new Date())', () => {
      const invalidRaw: RawSecopProcess = {
        id_del_proceso: '',
        referencia_del_proceso: '',
        nombre_del_procedimiento: '',
        entidad: '',
        nit_entidad: '',
      };

      const result = adapter.mapToOpportunity(invalidRaw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('ValidationError');
        expect(result.error.fields).toContain('title');
        expect(result.error.fields).toContain('contractingEntity.name');
        expect(result.error.fields).toContain('publishedAt');
      }
    });
  });

  describe('mapStatus catalog translation', () => {
    let adapter: SecopAdapter;

    beforeEach(() => {
      adapter = new SecopAdapter({ logger: fakeLogger });
    });

    it('maps known publication statuses (Publicado, Evaluación, Abierto, Aprobado) to Published', () => {
      expect(adapter.mapStatus('Publicado')).toBe('Published');
      expect(adapter.mapStatus('Evaluación')).toBe('Published');
      expect(adapter.mapStatus('Abierto')).toBe('Published');
      expect(adapter.mapStatus('Aprobado')).toBe('Published');
      expect(adapter.mapStatus('', 'Presentación de oferta')).toBe('Published');
    });

    it('maps non-actionable statuses (Borrador, En aprobación, Suspendido) to Draft', () => {
      expect(adapter.mapStatus('Borrador')).toBe('Draft');
      expect(adapter.mapStatus('En aprobación')).toBe('Draft');
      expect(adapter.mapStatus('Suspendido')).toBe('Draft');
    });

    it('maps amendment statuses to Amended', () => {
      expect(adapter.mapStatus('Modificado')).toBe('Amended');
      expect(adapter.mapStatus('Adenda')).toBe('Amended');
      expect(adapter.mapStatus('', 'Modificado')).toBe('Amended');
    });

    it('maps closed statuses to Closed', () => {
      expect(adapter.mapStatus('Cerrado')).toBe('Closed');
      expect(adapter.mapStatus('', 'Cerrado')).toBe('Closed');
    });

    it('maps awarded statuses to Awarded', () => {
      expect(adapter.mapStatus('Seleccionado')).toBe('Awarded');
      expect(adapter.mapStatus('Adjudicado')).toBe('Awarded');
      expect(adapter.mapStatus('', 'Adjudicado')).toBe('Awarded');
    });

    it('maps cancelled and deserted statuses to Cancelled', () => {
      expect(adapter.mapStatus('Cancelado')).toBe('Cancelled');
      expect(adapter.mapStatus('Desierto')).toBe('Cancelled');
    });

    it('logs warning and returns Unknown for undefined or empty input', () => {
      expect(adapter.mapStatus(undefined, undefined)).toBe('Unknown');
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        'Empty SECOP status encountered; falling back to OpportunityStatus.Unknown.',
      );
    });

    it('logs warning and returns Unknown for unmapped string', () => {
      expect(adapter.mapStatus('EstadoMisterioso', 'ResumenDesconocido')).toBe('Unknown');
      expect(fakeLogger.warn).toHaveBeenCalledWith(
        'Unmapped SECOP status: "EstadoMisterioso" (resumen: "ResumenDesconocido"). Falling back to OpportunityStatus.Unknown.',
      );
    });
  });
});
