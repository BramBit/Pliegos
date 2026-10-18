import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedOpportunity, seedProfile } from '../modules/shared/testing/seed';
import { requireTestDatabaseUrl } from '../modules/shared/testing/test-database-url';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
const request = ((supertest as any).default || supertest) as typeof supertest;
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { setupSwaggerAndScalar } from '../setup-swagger';
import { DATABASE_POOL } from '../modules/shared/infrastructure/persistence/database.module';
import { migrateTestDatabase } from '../modules/shared/testing/migrate-test-database';
import { OPPORTUNITY_SOURCE_PORT } from '../modules/opportunity/domain/ports/opportunity-source.port';
import {
  EMBEDDER_PORT,
  TEXT_GENERATOR_PORT,
} from '../modules/recommendation/domain/ports/ai-provider.port';
import { ANALYSIS_QUEUE_PORT } from '../modules/opportunity/domain/ports/analysis-queue.port';
import { RECOMMENDATION_REFRESH_QUEUE_PORT } from '../modules/recommendation/domain/ports/recommendation-refresh-queue.port';
import { NOTIFICATION_PORT } from '../modules/alert/domain/ports/notification.port';
import { RecommendationRepositoryPort, RECOMMENDATION_REPOSITORY_PORT } from '../modules/recommendation/domain/ports/recommendation.repository.port';
import { ProfileRepositoryPort, PROFILE_REPOSITORY_PORT } from '../modules/profile/domain/ports/profile.repository.port';
import { AlertRepositoryPort, ALERT_REPOSITORY_PORT } from '../modules/alert/domain/ports/alert.repository.port';
import { createAlert } from '../modules/alert/domain/entities/alert.entity';
import { asAlertId, asOpportunityId, asProfileId, asRecommendationId } from '../modules/shared/domain/typed-id';
import { createRecommendation } from '../modules/recommendation/domain/entities/recommendation.entity';
import { createRelevanceScore } from '../modules/opportunity/domain/value-objects/relevance-score.vo';
import { HashEmbedder } from '../modules/shared/testing/hash-embedder';

describe('Pliegos Phase 1 REST Surface (E2E)', () => {
  let app: INestApplication;
  let pool: Pool;
  let profileRepo: ProfileRepositoryPort;
  let recRepo: RecommendationRepositoryPort;
  let alertRepo: AlertRepositoryPort;

  beforeAll(async () => {
    const testDbUrl = requireTestDatabaseUrl();

    pool = new Pool({ connectionString: testDbUrl });
    await migrateTestDatabase(pool);

    const mockEmbedder = new HashEmbedder('nomic-embed-text');
    const mockTextGenerator = {
      summarize: jest.fn().mockResolvedValue('Resumen ejecutivo de prueba generado por IA'),
    };

    const mockSource = {
      async *fetchPages() {
        yield [
          {
            externalId: 'CO1.REQ.E2E.999',
            humanReference: 'E2E-REF-01',
            title: 'Servicio de desarrollo de software para plataforma de contratacion',
            description: 'Desarrollo web e integracion de APIs de inteligencia artificial',
            entityName: 'MinTIC',
            entityTaxId: '899999001-1',
            city: 'Bogotá',
            department: 'Cundinamarca',
            amount: 150000000,
            contractType: 'Prestación de servicios',
            procurementModality: 'Contratación directa',
            isCompetitive: false,
            categoryCode: '80111600',
            publishedAt: new Date('2026-01-15T08:00:00.000Z'),
            lastPublishedAt: new Date('2026-01-15T08:00:00.000Z'),
            closingDate: null,
            isOpenForSubmission: false,
            status: 'Awarded' as const,
            originalUrl: 'https://community.secop.gov.co/Process/E2E-01',
          },
        ];
      },
    };

    const mockQueue = {
      enqueueAnalysis: jest.fn().mockResolvedValue(undefined),
    };

    const mockRefreshQueue = {
      enqueueRefresh: jest.fn().mockResolvedValue(undefined),
      enqueueRefreshForAllProfiles: jest.fn().mockResolvedValue(0),
    };

    const mockNotification = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .overrideProvider(OPPORTUNITY_SOURCE_PORT)
      .useValue(mockSource)
      .overrideProvider(EMBEDDER_PORT)
      .useValue(mockEmbedder)
      .overrideProvider(TEXT_GENERATOR_PORT)
      .useValue(mockTextGenerator)
      .overrideProvider(ANALYSIS_QUEUE_PORT)
      .useValue(mockQueue)
      .overrideProvider(RECOMMENDATION_REFRESH_QUEUE_PORT)
      .useValue(mockRefreshQueue)
      .overrideProvider(NOTIFICATION_PORT)
      .useValue(mockNotification)
      .compile();

    app = moduleFixture.createNestApplication();
    setupSwaggerAndScalar(app);
    await app.init();

    profileRepo = moduleFixture.get<ProfileRepositoryPort>(PROFILE_REPOSITORY_PORT);
    recRepo = moduleFixture.get<RecommendationRepositoryPort>(RECOMMENDATION_REPOSITORY_PORT);
    alertRepo = moduleFixture.get<AlertRepositoryPort>(ALERT_REPOSITORY_PORT);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (pool) {
      await pool.end();
    }
  });

  describe('API Documentation Surfaces', () => {
    it('GET /api-json returns valid OpenAPI 3.0 specification and saves docs/openapi.json', async () => {
      const response = await request(app.getHttpServer())
        .get('/api-json')
        .set('X-Request-Id', 'e2e-openapi-req-1')
        .expect(200);

      expect(response.headers['x-request-id']).toBe('e2e-openapi-req-1');
      expect(response.body).toBeDefined();
      expect(response.body.openapi).toMatch(/^3\./);
      expect(response.body.info.title).toBe('Pliegos API');
      expect(response.body.paths).toHaveProperty('/opportunities/{id}');
      expect(response.body.paths).toHaveProperty('/opportunities/sync');
      expect(response.body.paths).toHaveProperty('/opportunities');
      expect(response.body.paths).not.toHaveProperty('/opportunities/search');
      expect(response.body.paths).toHaveProperty('/profiles');
      expect(response.body.paths).toHaveProperty('/recommendations/{profileId}');
      expect(response.body.paths).toHaveProperty('/recommendations/{id}/feedback');
      expect(response.body.paths).toHaveProperty('/alerts/review-follow-up');

      writeFileSync(
        resolve(process.cwd(), 'docs/openapi.json'),
        JSON.stringify(response.body, null, 2) + '\n',
        'utf8',
      );
    });

    it('GET /reference mounts Scalar interactive reference HTML', async () => {
      const response = await request(app.getHttpServer()).get('/reference').expect(200);

      expect(response.text).toContain('Pliegos API Reference');
      expect(response.text).toContain('scalar');
    });
  });

  describe('OpportunityController', () => {
    it('POST /opportunities/sync syncs data from source', async () => {
      const response = await request(app.getHttpServer())
        .post('/opportunities/sync')
        .send({ since: '2026-01-01T00:00:00.000Z' })
        .expect(200);

      expect(response.body).toBeDefined();
      expect(typeof response.body.created).toBe('number');
      expect(typeof response.body.updated).toBe('number');
    });

    it('POST /opportunities/sync rejects invalid date with 400 (Zod) and error envelope', async () => {
      const response = await request(app.getHttpServer())
        .post('/opportunities/sync')
        .set('X-Request-Id', 'req-sync-invalid-400')
        .send({ since: 'not-a-valid-date' })
        .expect(400);

      expect(response.headers['x-request-id']).toBe('req-sync-invalid-400');
      expect(response.body.statusCode).toBe(400);
      expect(response.body.error).toBe('ValidationError');
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.details).toBeDefined();
      expect(response.body.errors).toBeDefined();
      expect(response.body.requestId).toBe('req-sync-invalid-400');
    });

    it('GET /opportunities returns paginated Page<OpportunitySummary> with default params', async () => {
      const response = await request(app.getHttpServer())
        .get('/opportunities')
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page', 1);
      expect(response.body).toHaveProperty('pageSize', 20);
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    it('GET /opportunities supports hybrid candidate search with q and relevance sort', async () => {
      const response = await request(app.getHttpServer())
        .get('/opportunities')
        .query({ q: 'software', sort: 'relevance', order: 'desc', pageSize: 10 })
        .expect(200);

      expect(response.body.page).toBe(1);
      expect(response.body.pageSize).toBe(10);
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    it('GET /opportunities supports pagination (page and pageSize)', async () => {
      const response = await request(app.getHttpServer())
        .get('/opportunities')
        .query({ page: 2, pageSize: 5 })
        .expect(200);

      expect(response.body.page).toBe(2);
      expect(response.body.pageSize).toBe(5);
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    it('GET /opportunities supports each sort field and order', async () => {
      await request(app.getHttpServer())
        .get('/opportunities')
        .query({ sort: 'publishedAt', order: 'asc' })
        .expect(200);

      await request(app.getHttpServer())
        .get('/opportunities')
        .query({ sort: 'closingDate', order: 'desc' })
        .expect(200);

      await request(app.getHttpServer())
        .get('/opportunities')
        .query({ sort: 'amount', order: 'asc' })
        .expect(200);
    });

    it('GET /opportunities supports filters: department, categoryPrefix, minAmount, maxAmount, status, modality, closingAfter, closingBefore', async () => {
      const response = await request(app.getHttpServer())
        .get('/opportunities')
        .query({
          department: 'Antioquia',
          categoryPrefix: 'V1.43',
          minAmount: 10000000,
          maxAmount: 500000000,
          status: 'Published',
          modality: 'Licitación pública',
          onlyCompetitive: 'true',
          onlyOpen: 'true',
          closingAfter: '2026-01-01T00:00:00.000Z',
          closingBefore: '2026-12-31T23:59:59.000Z',
        })
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
    });

    it('GET /opportunities/:id returns 404 with error envelope for non-existent id', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app.getHttpServer())
        .get(`/opportunities/${nonExistentId}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.error).toBe('OpportunityNotFoundError');
      expect(response.body.requestId).toBeDefined();
    });

    it('GET /opportunities/:id returns OpportunityDetail for an existing opportunity', async () => {
      const listResp = await request(app.getHttpServer())
        .get('/opportunities')
        .query({ pageSize: 1 })
        .expect(200);

      if (listResp.body.items.length > 0) {
        const existingId = listResp.body.items[0].id;
        const detailResp = await request(app.getHttpServer())
          .get(`/opportunities/${existingId}`)
          .expect(200);

        expect(detailResp.body.id).toBe(existingId);
        expect(detailResp.body).toHaveProperty('summaryStatus');
        expect(detailResp.body).toHaveProperty('isCompetitive');
        expect(detailResp.body).toHaveProperty('sourceUrl');
        expect(detailResp.body).toHaveProperty('daysToClose');
      }
    });

    it('GET /opportunities rejects invalid query values with 400', async () => {
      // pageSize > 50
      await request(app.getHttpServer())
        .get('/opportunities')
        .query({ pageSize: 100 })
        .expect(400);

      // sort=relevance without q
      await request(app.getHttpServer())
        .get('/opportunities')
        .query({ sort: 'relevance' })
        .expect(400);

      // negative minAmount
      await request(app.getHttpServer())
        .get('/opportunities')
        .query({ minAmount: -500 })
        .expect(400);

      // invalid status
      await request(app.getHttpServer())
        .get('/opportunities')
        .query({ status: 'InvalidStatus' })
        .expect(400);
    });
  });

  describe('ProfileController', () => {
    it('POST /profiles creates a new contractor profile', async () => {
      const profilePayload = {
        ownerId: 'user-e2e-contractor-01',
        sector: 'Tecnología e Inteligencia Artificial',
        capabilities: [
          { name: 'Desarrollo Fullstack y Arquitectura Hexagonal', yearsOfExperience: 6 },
        ],
        preferences: {
          categoryCodes: ['V1.80111600'],
          keywords: ['software', 'inteligencia artificial', 'cloud'],
          amountRange: { min: 50000000, max: 300000000 },
          departments: ['Cundinamarca', 'Antioquia'],
        },
      };

      const response = await request(app.getHttpServer())
        .post('/profiles')
        .send(profilePayload)
        .expect(200);

      expect(response.body.id).toBeDefined();
      expect(response.body.ownerId).toBe(profilePayload.ownerId);
      expect(response.body.sector).toBe(profilePayload.sector);
      expect(response.body.capabilities.length).toBe(1);
    });

    it('POST /profiles rejects payload when amountRange min > max with 400 (Zod)', async () => {
      const invalidPayload = {
        ownerId: 'user-invalid',
        sector: 'Construcción',
        capabilities: [],
        preferences: {
          categoryCodes: [],
          keywords: [],
          amountRange: { min: 500000000, max: 10000000 },
          departments: [],
        },
      };

      const response = await request(app.getHttpServer())
        .post('/profiles')
        .send(invalidPayload)
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toBe('Validation failed');
    });
  });

  describe('RecommendationController', () => {
    it('GET /recommendations/:profileId returns 404 when profile does not exist', async () => {
      const nonExistentProfileId = asProfileId('00000000-0000-0000-0000-000000000999');
      const response = await request(app.getHttpServer())
        .get(`/recommendations/${nonExistentProfileId}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.message).toContain(nonExistentProfileId);
    });

    it('GET /recommendations/:profileId computes and returns recommendations for existing profile', async () => {
      // Create a profile first
      const createResponse = await request(app.getHttpServer())
        .post('/profiles')
        .send({
          ownerId: 'user-rec-test',
          sector: 'Tecnología',
          capabilities: [{ name: 'Software', yearsOfExperience: 3 }],
          preferences: {
            categoryCodes: ['V1.80111600'],
            keywords: ['software'],
            amountRange: { min: 10000000, max: 200000000 },
            departments: ['Cundinamarca'],
          },
        })
        .expect(200);

      const profileId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .get(`/recommendations/${profileId}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      if (response.body.length > 0) {
        expect(response.body[0]).toHaveProperty('score');
        expect(response.body[0]).toHaveProperty('explanation');
      }
    });

    it('POST /recommendations/:id/feedback records user decision (Participate)', async () => {
      const dummyRecId = asRecommendationId('rec-e2e-feedback-01');
      const scoreResult = createRelevanceScore(0.88);
      if (!scoreResult.ok) throw new Error(scoreResult.error.message);
      const testRecResult = createRecommendation({
        id: dummyRecId,
        profileId: asProfileId('prof-feedback-test'),
        opportunityId: asOpportunityId('opp-feedback-test'),
        score: scoreResult.value,
        explanation: {
          summary: 'Alta coincidencia con tu perfil',
          matchedFactors: [
            { factor: 'semanticSimilarity', score: 0.85, description: 'Excelente similitud semántica' },
          ],
        },
      });
      if (!testRecResult.ok) throw new Error(testRecResult.error.message);
      const testRec = testRecResult.value;

      await seedProfile(pool, 'prof-feedback-test');
      await seedOpportunity(pool, 'opp-feedback-test');
      await recRepo.save(testRec);

      const response = await request(app.getHttpServer())
        .post(`/recommendations/${dummyRecId}/feedback`)
        .send({ decision: 'Participate' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Feedback recorded successfully');

      const updated = await recRepo.findById(dummyRecId);
      expect(updated?.feedback?.decision).toBe('Participate');
    });

    it('POST /recommendations/:id/feedback rejects invalid decision with 400 (Zod)', async () => {
      const response = await request(app.getHttpServer())
        .post('/recommendations/rec-any/feedback')
        .send({ decision: 'InvalidDecisionValue' })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toBe('Validation failed');
    });

    it('POST /recommendations/:id/feedback returns 404 for unknown recommendation', async () => {
      const response = await request(app.getHttpServer())
        .post('/recommendations/non-existent-rec-id/feedback')
        .send({ decision: 'Discard' })
        .expect(404);

      expect(response.body.statusCode).toBe(404);
    });
  });

  describe('AlertController', () => {
    it('POST /alerts/review-follow-up executes follow-up and notifies pending alerts', async () => {
      const alertResult = createAlert({
        id: asAlertId('alert-e2e-01'),
        profileId: asProfileId('profile-alert-e2e'),
        opportunityId: asOpportunityId('opp-alert-e2e'),
        trigger: 'Amendment',
        deliveredAt: null,
      });
      if (!alertResult.ok) throw new Error(alertResult.error.message);
      const alert = alertResult.value;

      await seedProfile(pool, 'profile-alert-e2e');
      await alertRepo.save(alert);

      const response = await request(app.getHttpServer())
        .post('/alerts/review-follow-up')
        .expect(200);

      expect(response.body).toBeDefined();
      expect(typeof response.body.alertsSent).toBe('number');
      expect(response.body.alertsSent).toBeGreaterThanOrEqual(1);
    });
  });
});
