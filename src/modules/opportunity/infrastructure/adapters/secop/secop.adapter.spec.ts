import * as fs from 'node:fs';
import * as path from 'node:path';
import { LoggerService } from '@nestjs/common';
import { SecopAdapter, DEFAULT_SECOP_ENDPOINT } from './secop.adapter';
import { RawSecopProcess } from '../../../domain/ports/opportunity-source.port';
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

  describe('fetchLatest (network / endpoint abstraction)', () => {
    it('calls default endpoint and returns parsed json from response', async () => {
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
      expect(parsedUrl.searchParams.get('$order')).toBe('fecha_de_publicacion_del DESC');
      expect(parsedUrl.searchParams.get('$where')).toBeNull();
      expect(result).toHaveLength(sampleFixture.length);
      expect(result[0].id_del_proceso).toBe('CO1.REQ.7128715');
    });

    it('adds SoQL $where clause when since Date is provided', async () => {
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
      expect(parsedUrl.searchParams.get('$where')).toBe(`fecha_de_publicacion_del >= '${since.toISOString()}'`);
      expect(parsedUrl.searchParams.get('$order')).toBe('fecha_de_publicacion_del DESC');
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
      });

      await expect(adapter.fetchLatest()).rejects.toThrow(
        'Failed to fetch from SECOP endpoint (https://www.datos.gov.co/resource/p6dx-8zbt.json): HTTP 503 Service Unavailable',
      );
    });
  });

  describe('mapToOpportunity (Technical Design §1.2 mapping rules)', () => {
    let adapter: SecopAdapter;

    beforeEach(() => {
      adapter = new SecopAdapter({ logger: fakeLogger });
    });

    it('maps competitive process with closingDate and unwraps urlproceso.url', () => {
      const raw = sampleFixture[0]; // CO1.REQ.7128715
      const result = adapter.mapToOpportunity(raw, asOpportunityId('opp-test-1'));

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const opp = result.value;
      expect(opp.id).toBe('opp-test-1');
      expect(opp.title).toBe('SUMINISTRO ELECTROBOMBAS');
      expect(opp.contractingEntity).toEqual({
        name: 'COLEGIO GABRIEL BETANCOURT MEJIA I.E.D',
        taxId: '900143276',
      });
      expect(opp.location).toEqual({
        city: 'No Definido',
        department: 'Distrito Capital de Bogotá',
      });
      expect(opp.amount).toEqual({
        amount: 5500000,
        currency: 'COP',
      });
      expect(opp.contractType).toBe('Otro');
      expect(opp.procurementModality).toBe('Contratación régimen especial (con ofertas)');
      expect(opp.categoryCode).toBe('V1.40151500');
      expect(opp.publishedAt).toEqual(new Date('2024-11-06T00:00:00.000'));
      // Verified closingDate is present
      expect(opp.closingDate).toEqual(new Date('2024-11-12T00:00:00.000'));
      expect(opp.isOpenForSubmission).toBe(false); // 'Cerrado'
      expect(opp.status).toBe('Published'); // 'Evaluación'
      // Unwrapped nested object urlproceso.url
      expect(opp.source).toEqual({
        sourceName: 'SECOP',
        externalId: 'CO1.REQ.7128715',
        humanReference: 'RE-CGBM-049-2024',
        originalUrl: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.7008964',
      });
    });

    it('maps direct contracting process with null closingDate per design §1.2', () => {
      const raw = sampleFixture[1]; // CO1.REQ.9845111 - Contratación directa
      const result = adapter.mapToOpportunity(raw);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const opp = result.value;
      expect(opp.procurementModality).toBe('Contratación directa');
      // Confirmed legitimately null for direct contracting
      expect(opp.closingDate).toBeNull();
      expect(opp.contractingEntity.name).toBe('INVIAS');
      expect(opp.contractingEntity.taxId).toBe('800215807');
      expect(opp.amount.amount).toBe(48620250);
      expect(opp.isOpenForSubmission).toBe(true); // 'Abierto'
      expect(opp.status).toBe('Awarded'); // 'Seleccionado'
      expect(opp.source.originalUrl).toBe(
        'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.9690232',
      );
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
      expect(opp.amount.amount).toBe(2214931820);
    });

    it('maps published regime special process with open submission', () => {
      const raw = sampleFixture[3]; // CO1.REQ.10388845
      const result = adapter.mapToOpportunity(raw);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const opp = result.value;
      expect(opp.status).toBe('Published');
      expect(opp.isOpenForSubmission).toBe(true);
      expect(opp.closingDate).toBeNull(); // not provided in this process
    });

    it('falls back to OpportunityStatus.Unknown and logs a warning for unmapped status', () => {
      const raw = sampleFixture[4]; // CO1.REQ.9999999 - EstadoIneditoNoMapeado
      const result = adapter.mapToOpportunity(raw);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const opp = result.value;
      expect(opp.status).toBe('Unknown');

      // Verify warning was logged
      expect(fakeLogger.warn).toHaveBeenCalled();
      const warningFound = fakeLogger.warnings.some((w) =>
        w.includes('Unmapped SECOP status: "EstadoIneditoNoMapeado"'),
      );
      expect(warningFound).toBe(true);
    });

    it('returns ValidationError if required domain fields are missing', () => {
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
      }
    });
  });

  describe('mapStatus catalog translation', () => {
    let adapter: SecopAdapter;

    beforeEach(() => {
      adapter = new SecopAdapter({ logger: fakeLogger });
    });

    it('maps known publication statuses to Published', () => {
      expect(adapter.mapStatus('Publicado')).toBe('Published');
      expect(adapter.mapStatus('Evaluación')).toBe('Published');
      expect(adapter.mapStatus('', 'Presentación de oferta')).toBe('Published');
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
