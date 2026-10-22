import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import {
  DomainErrorException,
  ErrorEnvelope,
  GlobalExceptionFilter,
} from './global-exception.filter';
import { RequestIdMiddleware, RequestWithId } from './request-id.middleware';
import {
  toAlertDto,
  toOpportunityDetailDto,
  toOpportunitySummaryDto,
  toProfileDto,
  toRecommendationDto,
} from './response.dtos';
import {
  createOpportunityNotFoundError,
  createProfileNotFoundError,
  createRecommendationNotFoundError,
  createSourceUnavailableError,
  createValidationError,
} from '../../domain/errors';
import {
  asAlertId,
  asOpportunityId,
  asProfileId,
  asRecommendationId,
  asUserId,
} from '../../domain/typed-id';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';
import { Profile } from '../../../profile/domain/entities/profile.entity';
import { Recommendation } from '../../../recommendation/domain/entities/recommendation.entity';
import { Alert } from '../../../alert/domain/entities/alert.entity';

describe('HTTP Contract: RequestIdMiddleware, GlobalExceptionFilter & Response DTOs (P3.1)', () => {
  describe('RequestIdMiddleware', () => {
    it('echoes incoming X-Request-Id header when provided', () => {
      const middleware = new RequestIdMiddleware();
      const req: RequestWithId = {
        headers: { 'x-request-id': 'custom-req-id-99' },
      };
      const headersSet: Record<string, string> = {};
      const res = {
        setHeader: (name: string, value: string) => {
          headersSet[name] = value;
        },
      };
      const next = jest.fn();

      middleware.use(req, res, next);

      expect(req.requestId).toBe('custom-req-id-99');
      expect(headersSet['X-Request-Id']).toBe('custom-req-id-99');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('generates a UUID when X-Request-Id is missing or empty', () => {
      const middleware = new RequestIdMiddleware();
      const req: RequestWithId = {
        headers: {},
      };
      const headersSet: Record<string, string> = {};
      const res = {
        setHeader: (name: string, value: string) => {
          headersSet[name] = value;
        },
      };
      const next = jest.fn();

      middleware.use(req, res, next);

      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(headersSet['X-Request-Id']).toBe(req.requestId);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('GlobalExceptionFilter', () => {
    let errorLogs: string[];
    let warnLogs: string[];
    let filter: GlobalExceptionFilter;

    beforeEach(() => {
      errorLogs = [];
      warnLogs = [];
      filter = new GlobalExceptionFilter({
        log: jest.fn(),
        error: jest.fn((msg: string) => errorLogs.push(msg)),
        warn: jest.fn((msg: string) => warnLogs.push(msg)),
        debug: jest.fn(),
        verbose: jest.fn(),
      });
    });

    function runFilter(exception: unknown, requestIdHeader?: string): {
      statusCode: number;
      body: ErrorEnvelope;
      responseHeaders: Record<string, string>;
    } {
      let capturedStatus = 0;
      let capturedBody!: ErrorEnvelope;
      const responseHeaders: Record<string, string> = {};

      const req: RequestWithId = {
        headers: requestIdHeader ? { 'x-request-id': requestIdHeader } : {},
        method: 'POST',
        originalUrl: '/test-endpoint',
      };
      const res = {
        setHeader: (name: string, value: string) => {
          responseHeaders[name] = value;
        },
        status: (code: number) => {
          capturedStatus = code;
          return {
            json: (body: ErrorEnvelope) => {
              capturedBody = body;
            },
          };
        },
      };

      const host = {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => res,
        }),
      } as unknown as ArgumentsHost;

      filter.catch(exception, host);
      return { statusCode: capturedStatus, body: capturedBody, responseHeaders };
    }

    it('maps ValidationError to 400 with details and requestId in log', () => {
      const domainErr = createValidationError(['amountRange'], 'min cannot exceed max');
      const { statusCode, body, responseHeaders } = runFilter(
        new DomainErrorException(domainErr),
        'req-val-400',
      );

      expect(statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(responseHeaders['X-Request-Id']).toBe('req-val-400');
      expect(body).toEqual({
        statusCode: 400,
        error: 'ValidationError',
        message: 'min cannot exceed max',
        details: ['amountRange'],
        requestId: 'req-val-400',
      });
      expect(warnLogs[0]).toContain('[requestId=req-val-400]');
    });

    it('logs 4xx exceptions at WARN level and 5xx exceptions at ERROR level', () => {
      runFilter(new DomainErrorException(createProfileNotFoundError(asProfileId('prof-warn'))), 'req-warn');
      expect(warnLogs).toHaveLength(1);
      expect(warnLogs[0]).toContain('404 ProfileNotFoundError');
      expect(errorLogs).toHaveLength(0);

      runFilter(new Error('Boom 500'), 'req-err');
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0]).toContain('500 InternalServerError');
    });

    it('maps ProfileNotFoundError, OpportunityNotFoundError, and RecommendationNotFoundError to 404', () => {
      const profRes = runFilter(
        new DomainErrorException(createProfileNotFoundError(asProfileId('prof-404'))),
        'req-404-a',
      );
      expect(profRes.statusCode).toBe(HttpStatus.NOT_FOUND);
      expect(profRes.body.error).toBe('ProfileNotFoundError');
      expect(profRes.body.requestId).toBe('req-404-a');

      const oppRes = runFilter(
        new DomainErrorException(createOpportunityNotFoundError(asOpportunityId('opp-404'))),
        'req-404-b',
      );
      expect(oppRes.statusCode).toBe(HttpStatus.NOT_FOUND);
      expect(oppRes.body.error).toBe('OpportunityNotFoundError');

      const recRes = runFilter(
        new DomainErrorException(createRecommendationNotFoundError(asRecommendationId('rec-404'))),
        'req-404-c',
      );
      expect(recRes.statusCode).toBe(HttpStatus.NOT_FOUND);
      expect(recRes.body.error).toBe('RecommendationNotFoundError');
    });

    it('maps SourceUnavailableError to 502 Bad Gateway', () => {
      const { statusCode, body } = runFilter(
        new DomainErrorException(createSourceUnavailableError('SECOP')),
        'req-502',
      );

      expect(statusCode).toBe(HttpStatus.BAD_GATEWAY);
      expect(body).toEqual({
        statusCode: 502,
        error: 'SourceUnavailableError',
        message: 'Fuente de contratación no disponible: SECOP',
        requestId: 'req-502',
      });
    });

    it('maps unexpected Error to 500 with a generic message and never leaks stack traces', () => {
      const secretError = new Error('SELECT * FROM users failed: password_hash column error');
      const { statusCode, body } = runFilter(secretError, 'req-500');

      expect(statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body).toEqual({
        statusCode: 500,
        error: 'InternalServerError',
        message: 'An unexpected error occurred',
        requestId: 'req-500',
      });
      expect(JSON.stringify(body)).not.toContain('SELECT * FROM users');
      expect(JSON.stringify(body)).not.toContain('at ');
      expect(errorLogs[0]).toContain('[requestId=req-500]');
      expect(errorLogs[0]).toContain('SELECT * FROM users');
    });

    it('maps NestJS BadRequestException (ZodValidationPipe) to 400 with details', () => {
      const ex = new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: [{ path: 'since', message: 'Invalid datetime' }],
      });
      const { statusCode, body } = runFilter(ex, 'req-zod-400');

      expect(statusCode).toBe(400);
      expect(body.error).toBe('ValidationError');
      expect(body.message).toBe('Validation failed');
      expect(body.details).toEqual([{ path: 'since', message: 'Invalid datetime' }]);
      expect(body.requestId).toBe('req-zod-400');
    });
  });

  describe('DTO Mappers (ISO-8601 dates, COP numbers, explicit nulls)', () => {
    const now = new Date('2026-10-18T00:00:00.000Z');
    const sampleOpp: Opportunity = {
      id: asOpportunityId('opp-dto-1'),
      title: 'Consultoria en calidad de alimentos',
      description: 'Auditoria e inocuidad alimentaria',
      contractingEntity: { name: 'INVIMA', taxId: '830000167' },
      location: { city: null, department: 'Bogotá D.C.' },
      amount: { amount: 120_000_000, currency: 'COP' },
      amountKnown: true,
      contractType: 'Consultoría',
      procurementModality: 'Concurso de méritos',
      isCompetitive: true,
      categoryCode: null,
      publishedAt: new Date('2026-10-10T10:00:00.000Z'),
      lastPublishedAt: new Date('2026-10-12T10:00:00.000Z'),
      closingDate: new Date('2026-10-23T00:00:00.000Z'),
      isOpenForSubmission: true,
      status: 'Published',
      source: {
        sourceName: 'SECOP',
        externalId: 'CO1.REQ.DTO1',
        humanReference: 'INV-CM-01',
        originalUrl: 'https://community.secop.gov.co/dto1',
      },
      analysis: {
        summary: 'Resumen de consultoría en inocuidad.',
        summaryStatus: 'ready',
        requirements: [],
        embeddingGeneratedAt: new Date('2026-10-12T11:00:00.000Z'),
      },
      changeHistory: [
        {
          field: 'closingDate',
          previousValue: '2026-10-20T00:00:00.000Z',
          newValue: '2026-10-23T00:00:00.000Z',
          detectedAt: new Date('2026-10-12T10:00:00.000Z'),
          material: true,
        },
      ],
    };

    it('maps OpportunitySummary and OpportunityDetail with ISO dates, number amount, daysToClose, and explicit nulls', () => {
      const summaryDto = toOpportunitySummaryDto(sampleOpp, now);
      expect(summaryDto.amount).toBe(120_000_000);
      expect(summaryDto.city).toBeNull();
      expect(summaryDto.categoryCode).toBeNull();
      expect(summaryDto.publishedAt).toBe('2026-10-10T10:00:00.000Z');
      expect(summaryDto.closingDate).toBe('2026-10-23T00:00:00.000Z');
      expect(summaryDto.daysToClose).toBe(5);
      expect(summaryDto.summaryStatus).toBe('ready');

      const detailDto = toOpportunityDetailDto(sampleOpp, undefined, now);
      expect(detailDto.summary).toBe('Resumen de consultoría en inocuidad.');
      expect(detailDto.sourceUrl).toBe('https://community.secop.gov.co/dto1');
      expect(detailDto.changeHistory[0].detectedAt).toBe('2026-10-12T10:00:00.000Z');
      expect(detailDto.changeHistory[0].material).toBe(true);
    });

    it('maps Recommendation, Profile, and Alert DTOs with embedded OpportunitySummary and explicit nulls', () => {
      const rec: Recommendation = {
        id: asRecommendationId('rec-dto-1'),
        profileId: asProfileId('prof-dto-1'),
        opportunityId: sampleOpp.id,
        score: 0.85,
        explanation: {
          summary: 'Afinidad del 85%',
          matchedFactors: [],
          unavailableFactors: ['La oportunidad no declara categoría UNSPSC'],
        },
        feedback: null,
      };
      const recDto = toRecommendationDto(rec, sampleOpp, now);
      expect(recDto.feedback).toBeNull();
      expect(recDto.opportunity?.id).toBe('opp-dto-1');
      expect(recDto.explanation.unavailableFactors).toEqual([
        'La oportunidad no declara categoría UNSPSC',
      ]);

      const profile: Profile = {
        id: asProfileId('prof-dto-1'),
        ownerId: asUserId('user-1'),
        sector: 'Alimentos',
        capabilities: [{ name: 'HACCP', yearsOfExperience: 5 }],
        preferences: {
          categoryCodes: [],
          keywords: ['alimentos'],
          amountRange: null,
          departments: ['Bogotá D.C.'],
        },
      };
      const profileDto = toProfileDto(profile);
      expect(profileDto.preferences.amountRange).toBeNull();

      const alert: Alert = {
        id: asAlertId('alert-dto-1'),
        profileId: profile.id,
        opportunityId: sampleOpp.id,
        trigger: 'Amendment',
        changeKey: '',
        attempts: 0,
        lastError: null,
        readAt: null,
        deliveredAt: null,
      };
      const alertDto = toAlertDto(alert);
      expect(alertDto.trigger).toBe('Amendment');
      expect(alertDto.deliveredAt).toBeNull();
    });
  });
});
