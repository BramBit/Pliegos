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
import { setupSecurity } from '../setup-app';
import { SyncOpportunitiesUseCase } from '../modules/opportunity/application/use-cases/sync-opportunities.use-case';
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
import {
  RecommendationRepositoryPort,
  RECOMMENDATION_REPOSITORY_PORT,
} from '../modules/recommendation/domain/ports/recommendation.repository.port';
import {
  ProfileRepositoryPort,
  PROFILE_REPOSITORY_PORT,
} from '../modules/profile/domain/ports/profile.repository.port';
import {
  AlertRepositoryPort,
  ALERT_REPOSITORY_PORT,
} from '../modules/alert/domain/ports/alert.repository.port';
import { createAlert } from '../modules/alert/domain/entities/alert.entity';
import {
  asAlertId,
  asOpportunityId,
  asProfileId,
  asRecommendationId,
} from '../modules/shared/domain/typed-id';
import { createRecommendation } from '../modules/recommendation/domain/entities/recommendation.entity';
import { createRelevanceScore } from '../modules/opportunity/domain/value-objects/relevance-score.vo';
import { HashEmbedder } from '../modules/shared/testing/hash-embedder';
import { JwtService } from '@nestjs/jwt';
import { listOpportunitiesQuerySchema } from '../modules/opportunity/infrastructure/controllers/dtos/search-opportunities.dto';

describe('Pliegos Phase 1 REST Surface (E2E)', () => {
  let app: INestApplication;
  let pool: Pool;
  let profileRepo: ProfileRepositoryPort;
  let recRepo: RecommendationRepositoryPort;
  let alertRepo: AlertRepositoryPort;
  let jwtService: JwtService;
  let authToken: string;
  let expiredToken: string;

  beforeAll(async () => {
    const testDbUrl = requireTestDatabaseUrl();

    pool = new Pool({ connectionString: testDbUrl });
    await migrateTestDatabase(pool);
    await pool.query('DELETE FROM refresh_tokens;');
    await pool.query('DELETE FROM users;');
    await pool.query('DELETE FROM watches;');
    await pool.query('DELETE FROM alerts;');
    await pool.query('DELETE FROM recommendations;');
    await pool.query('DELETE FROM recommendation_runs;');
    await pool.query('DELETE FROM profiles;');
    await pool.query('DELETE FROM opportunities;');

    const mockEmbedder = new HashEmbedder('nomic-embed-text');
    const mockTextGenerator = {
      summarize: jest
        .fn()
        .mockResolvedValue('Resumen ejecutivo de prueba generado por IA'),
    };

    const mockSource = {
      async *fetchPages() {
        yield [
          {
            externalId: 'CO1.REQ.E2E.999',
            humanReference: 'E2E-REF-01',
            title:
              'Servicio de desarrollo de software para plataforma de contratacion',
            description:
              'Desarrollo web e integracion de APIs de inteligencia artificial',
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
    setupSecurity(app, { nodeEnv: 'test', corsOrigins: '' });
    setupSwaggerAndScalar(app);
    await app.init();

    const syncUseCase = moduleFixture.get(SyncOpportunitiesUseCase);
    await syncUseCase.execute({ since: new Date('2026-01-01T00:00:00.000Z') });

    profileRepo = moduleFixture.get<ProfileRepositoryPort>(
      PROFILE_REPOSITORY_PORT,
    );
    recRepo = moduleFixture.get<RecommendationRepositoryPort>(
      RECOMMENDATION_REPOSITORY_PORT,
    );
    alertRepo = moduleFixture.get<AlertRepositoryPort>(ALERT_REPOSITORY_PORT);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    authToken = jwtService.sign({
      sub: '00000000-0000-0000-0000-000000000001',
      role: 'admin',
    });
    expiredToken = jwtService.sign(
      { sub: '00000000-0000-0000-0000-000000000001', role: 'admin' },
      { expiresIn: '-1s' },
    );
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (pool && !(pool as any).ending && !(pool as any).ended) {
      await pool.end().catch(() => {});
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
      expect(response.body.paths).not.toHaveProperty('/opportunities/sync');
      expect(response.body.paths).toHaveProperty('/opportunities');
      expect(response.body.paths).not.toHaveProperty('/opportunities/search');
      expect(response.body.paths).toHaveProperty('/profiles');
      expect(response.body.paths).toHaveProperty('/profiles/{id}');
      expect(response.body.paths).toHaveProperty(
        '/profiles/{id}/recommendations',
      );
      expect(response.body.paths).toHaveProperty('/profiles/{id}/summary');
      expect(response.body.paths).toHaveProperty('/profiles/{id}/watches');
      expect(response.body.paths).toHaveProperty(
        '/profiles/{id}/watches/{opportunityId}',
      );
      expect(response.body.paths).not.toHaveProperty(
        '/recommendations/{profileId}',
      );
      expect(response.body.paths).toHaveProperty(
        '/recommendations/{id}/feedback',
      );
      expect(response.body.paths).not.toHaveProperty(
        '/alerts/review-follow-up',
      );
      expect(response.body.paths).toHaveProperty('/admin/sync');
      expect(response.body.paths).toHaveProperty('/admin/alerts/run');
      expect(response.body.paths).toHaveProperty(
        '/admin/recommendations/refresh',
      );
      expect(response.body.paths).toHaveProperty('/admin/jobs/{id}');
      expect(response.body.paths).toHaveProperty('/admin/metrics');
      expect(response.body.paths).toHaveProperty('/admin/pipeline');
      expect(response.body.paths).toHaveProperty('/auth/register');
      expect(response.body.paths).toHaveProperty('/auth/login');
      expect(response.body.paths).toHaveProperty('/auth/refresh');
      expect(response.body.paths).toHaveProperty('/auth/logout');
      expect(response.body.paths).toHaveProperty('/auth/me');

      writeFileSync(
        resolve(process.cwd(), 'docs/openapi.json'),
        JSON.stringify(response.body, null, 2) + '\n',
        'utf8',
      );
    });

    it('GET /opportunities documents every key of listOpportunitiesQuerySchema as a query parameter', async () => {
      const response = await request(app.getHttpServer())
        .get('/api-json')
        .expect(200);

      const schemaKeys = Object.keys(listOpportunitiesQuerySchema.in.shape);
      const parameters: Array<{ name: string; in: string }> =
        response.body.paths['/opportunities'].get.parameters ?? [];
      const queryParamNames = parameters
        .filter((p) => p.in === 'query')
        .map((p) => p.name);

      expect(schemaKeys.length).toBeGreaterThan(0);
      expect(queryParamNames.sort()).toEqual([...schemaKeys].sort());
    });

    it('GET /reference mounts Scalar interactive reference HTML', async () => {
      const response = await request(app.getHttpServer())
        .get('/reference')
        .expect(200);

      expect(response.text).toContain('Pliegos API Reference');
      expect(response.text).toContain('scalar');
    });
  });

  describe('OpportunityController', () => {
    it('POST /opportunities/sync returns 404 since it moved to /admin/sync', async () => {
      await request(app.getHttpServer())
        .post('/opportunities/sync')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('GET /opportunities returns paginated Page<OpportunitySummary> with default params', async () => {
      const response = await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          q: 'software',
          sort: 'relevance',
          order: 'desc',
          pageSize: 10,
        })
        .expect(200);

      expect(response.body.page).toBe(1);
      expect(response.body.pageSize).toBe(10);
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    it('GET /opportunities supports pagination (page and pageSize)', async () => {
      const response = await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 2, pageSize: 5 })
        .expect(200);

      expect(response.body.page).toBe(2);
      expect(response.body.pageSize).toBe(5);
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    it('GET /opportunities supports each sort field and order', async () => {
      await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ sort: 'publishedAt', order: 'asc' })
        .expect(200);

      await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ sort: 'closingDate', order: 'desc' })
        .expect(200);

      await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ sort: 'amount', order: 'asc' })
        .expect(200);
    });

    it('GET /opportunities supports filters: department, categoryPrefix, minAmount, maxAmount, status, modality, closingAfter, closingBefore', async () => {
      const response = await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.error).toBe('OpportunityNotFoundError');
      expect(response.body.requestId).toBeDefined();
    });

    it('GET /opportunities/:id returns OpportunityDetail for an existing opportunity', async () => {
      const listResp = await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ pageSize: 1 })
        .expect(200);

      if (listResp.body.items.length > 0) {
        const existingId = listResp.body.items[0].id;
        const detailResp = await request(app.getHttpServer())
          .get(`/opportunities/${existingId}`)
          .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
        .query({ pageSize: 100 })
        .expect(400);

      // sort=relevance without q
      await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ sort: 'relevance' })
        .expect(400);

      // negative minAmount
      await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ minAmount: -500 })
        .expect(400);

      // invalid status
      await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ status: 'InvalidStatus' })
        .expect(400);
    });
  });

  describe('ProfileController', () => {
    let createdProfileId: string;

    it('POST /profiles creates a new contractor profile with canonicalized departments and notification preferences', async () => {
      const profilePayload = {
        ownerId: 'user-e2e-contractor-01',
        name: 'Tech & AI Solutions SAS',
        contactEmail: 'licitaciones@techai.co',
        alertsEnabled: true,
        deadlineAlertDays: 4,
        sector: 'Tecnología e Inteligencia Artificial',
        capabilities: [
          {
            name: 'Desarrollo Fullstack y Arquitectura Hexagonal',
            yearsOfExperience: 6,
          },
        ],
        preferences: {
          categoryCodes: ['V1.80111600'],
          keywords: ['software', 'inteligencia artificial', 'cloud'],
          amountRange: { min: 50000000, max: 300000000 },
          departments: ['antioquia', 'BOGOTA'],
        },
      };

      const response = await request(app.getHttpServer())
        .post('/profiles')
        .set('Authorization', `Bearer ${authToken}`)
        .send(profilePayload)
        .expect(201);

      expect(response.body.id).toBeDefined();
      createdProfileId = response.body.id;
      expect(response.body.ownerId).toBe(
        '00000000-0000-0000-0000-000000000001',
      );
      expect(response.body.name).toBe(profilePayload.name);
      expect(response.body.contactEmail).toBe(profilePayload.contactEmail);
      expect(response.body.alertsEnabled).toBe(true);
      expect(response.body.deadlineAlertDays).toBe(4);
      expect(response.body.sector).toBe(profilePayload.sector);
      expect(response.body.capabilities.length).toBe(1);
      // Canonicalized departments
      expect(response.body.preferences.departments).toEqual([
        'Antioquia',
        'Bogotá D.C.',
      ]);
    });

    it('POST /profiles rejects unknown departments with 400 (Zod)', async () => {
      const invalidPayload = {
        ownerId: 'user-invalid-dept',
        sector: 'Consultoría',
        capabilities: [],
        preferences: {
          categoryCodes: [],
          keywords: [],
          departments: ['Antioquia', 'Narnia'],
        },
      };

      const response = await request(app.getHttpServer())
        .post('/profiles')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidPayload)
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toBe('Validation failed');
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
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidPayload)
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toBe('Validation failed');
    });

    it('POST /profiles rejects invalid contactEmail with 400', async () => {
      const invalidPayload = {
        ownerId: 'user-invalid-email',
        contactEmail: 'not-an-email',
        sector: 'Tecnología',
        capabilities: [],
        preferences: {
          categoryCodes: [],
          keywords: [],
          departments: [],
        },
      };

      const response = await request(app.getHttpServer())
        .post('/profiles')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidPayload)
        .expect(400);

      expect(response.body.statusCode).toBe(400);
    });

    it('POST /profiles rejects deadlineAlertDays outside 1..30 with 400', async () => {
      const payloadMin = {
        sector: 'Tecnología',
        deadlineAlertDays: 0,
        preferences: { keywords: ['software'], departments: [] },
      };
      await request(app.getHttpServer())
        .post('/profiles')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payloadMin)
        .expect(400);

      const payloadMax = {
        sector: 'Tecnología',
        deadlineAlertDays: 31,
        preferences: { keywords: ['software'], departments: [] },
      };
      await request(app.getHttpServer())
        .post('/profiles')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payloadMax)
        .expect(400);
    });

    it('GET /profiles returns profiles for the authenticated user', async () => {
      const response = await request(app.getHttpServer())
        .get('/profiles')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page', 1);
      expect(response.body).toHaveProperty('pageSize', 20);
      expect(Array.isArray(response.body.items)).toBe(true);
      expect(response.body.items.length).toBeGreaterThanOrEqual(1);
      expect(
        response.body.items.some((p: any) => p.id === createdProfileId),
      ).toBe(true);
    });

    it('GET /profiles/:id returns profile detail for existing profile and 404 for unknown', async () => {
      const response = await request(app.getHttpServer())
        .get(`/profiles/${createdProfileId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.id).toBe(createdProfileId);
      expect(response.body.name).toBe('Tech & AI Solutions SAS');

      await request(app.getHttpServer())
        .get('/profiles/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('PUT /profiles/:id replaces profile and returns updated entity', async () => {
      const updatedPayload = {
        ownerId: 'user-e2e-contractor-01',
        name: 'Tech & AI Solutions Colombia SAS',
        contactEmail: 'gerencia@techai.co',
        alertsEnabled: false,
        deadlineAlertDays: 7,
        sector: 'Inteligencia Artificial y Cloud',
        capabilities: [{ name: 'Arquitectura Cloud', yearsOfExperience: 8 }],
        preferences: {
          categoryCodes: ['V1.80111600'],
          keywords: ['cloud', 'ia'],
          amountRange: { min: 80000000, max: 400000000 },
          departments: ['valle'],
        },
      };

      const response = await request(app.getHttpServer())
        .put(`/profiles/${createdProfileId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updatedPayload)
        .expect(200);

      expect(response.body.id).toBe(createdProfileId);
      expect(response.body.name).toBe('Tech & AI Solutions Colombia SAS');
      expect(response.body.contactEmail).toBe('gerencia@techai.co');
      expect(response.body.alertsEnabled).toBe(false);
      expect(response.body.deadlineAlertDays).toBe(7);
      expect(response.body.preferences.departments).toEqual([
        'Valle del Cauca',
      ]);
    });

    it('DELETE /profiles/:id deletes the profile and returns 204', async () => {
      await request(app.getHttpServer())
        .delete(`/profiles/${createdProfileId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify it no longer exists
      await request(app.getHttpServer())
        .get(`/profiles/${createdProfileId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      // Deleting again returns 404
      await request(app.getHttpServer())
        .delete(`/profiles/${createdProfileId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('RecommendationController', () => {
    it('GET /recommendations/:profileId returns 404 when profile does not exist', async () => {
      const nonExistentProfileId = asProfileId(
        '00000000-0000-0000-0000-000000000999',
      );
      const response = await request(app.getHttpServer())
        .get(`/recommendations/${nonExistentProfileId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.message).toContain(nonExistentProfileId);
    });

    it('GET /profiles/:id/recommendations returns 404 for non-existent profile', async () => {
      const response = await request(app.getHttpServer())
        .get('/profiles/00000000-0000-0000-0000-000000000000/recommendations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.message).toContain(
        '00000000-0000-0000-0000-000000000000',
      );
    });

    it('GET /profiles/:id/recommendations returns paginated feed with single query and filters', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/profiles')
        .set('Authorization', `Bearer ${authToken}`)
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
        .expect(201);

      const profileId = createResponse.body.id;

      // Seed opportunity and recommendation
      const oppId = asOpportunityId('opp-e2e-feed-01');
      await seedOpportunity(pool, 'opp-e2e-feed-01');
      const recId = asRecommendationId('rec-e2e-feed-01');
      const scoreResult = createRelevanceScore(0.85);
      if (!scoreResult.ok) throw new Error(scoreResult.error.message);
      const testRecResult = createRecommendation({
        id: recId,
        profileId: asProfileId(profileId),
        opportunityId: oppId,
        score: scoreResult.value,
        explanation: {
          summary: 'Buena afinidad con perfil',
          matchedFactors: [
            {
              factor: 'semanticSimilarity',
              score: 0.85,
              description: 'Alta similitud semántica',
            },
          ],
        },
      });
      if (!testRecResult.ok) throw new Error(testRecResult.error.message);
      await recRepo.save(testRecResult.value);

      const response = await request(app.getHttpServer())
        .get(`/profiles/${profileId}/recommendations?state=new&pageSize=10`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page', 1);
      expect(response.body).toHaveProperty('pageSize', 10);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].id).toBe('rec-e2e-feed-01');
      expect(response.body.items[0].score).toBe(0.85);
      expect(response.body.items[0].opportunity).not.toBeNull();
      expect(response.body.items[0].opportunity.id).toBe('opp-e2e-feed-01');
    });

    it('POST and DELETE /recommendations/:id/feedback handles Participate, Discard and Undo with watch sync', async () => {
      const dummyRecId = asRecommendationId(
        '00000000-0000-0000-0000-000000000031',
      );
      const oppId = asOpportunityId('opp-feedback-test');
      const profId = asProfileId('00000000-0000-0000-0000-000000000021');

      const scoreResult = createRelevanceScore(0.88);
      if (!scoreResult.ok) throw new Error(scoreResult.error.message);
      const testRecResult = createRecommendation({
        id: dummyRecId,
        profileId: profId,
        opportunityId: oppId,
        score: scoreResult.value,
        explanation: {
          summary: 'Alta coincidencia con tu perfil',
          matchedFactors: [
            {
              factor: 'semanticSimilarity',
              score: 0.85,
              description: 'Excelente similitud semántica',
            },
          ],
        },
      });
      if (!testRecResult.ok) throw new Error(testRecResult.error.message);

      await seedProfile(pool, '00000000-0000-0000-0000-000000000021');
      await seedOpportunity(pool, 'opp-feedback-test');
      await recRepo.save(testRecResult.value);

      // 1. Participate -> creates watch
      const participateRes = await request(app.getHttpServer())
        .post(`/recommendations/${dummyRecId}/feedback`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ decision: 'Participate' })
        .expect(200);

      expect(participateRes.body.success).toBe(true);

      const watchCheck1 = await pool.query(
        'SELECT * FROM watches WHERE profile_id = $1 AND opportunity_id = $2;',
        [profId, oppId],
      );
      expect(watchCheck1.rows).toHaveLength(1);

      // 2. Undo feedback (DELETE) -> clears feedback and deletes watch
      const undoRes = await request(app.getHttpServer())
        .delete(`/recommendations/${dummyRecId}/feedback`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(undoRes.body.success).toBe(true);
      const updatedAfterUndo = await recRepo.findById(dummyRecId);
      expect(updatedAfterUndo?.feedback).toBeNull();

      const watchCheck2 = await pool.query(
        'SELECT * FROM watches WHERE profile_id = $1 AND opportunity_id = $2;',
        [profId, oppId],
      );
      expect(watchCheck2.rows).toHaveLength(0);

      // 3. Discard -> removes watch if existing
      await request(app.getHttpServer())
        .post(`/recommendations/${dummyRecId}/feedback`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ decision: 'Discard' })
        .expect(200);

      const updatedAfterDiscard = await recRepo.findById(dummyRecId);
      expect(updatedAfterDiscard?.feedback?.decision).toBe('Discard');
    });

    it('POST /recommendations/:id/feedback rejects invalid decision with 400 (Zod)', async () => {
      const response = await request(app.getHttpServer())
        .post('/recommendations/00000000-0000-0000-0000-000000000099/feedback')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ decision: 'InvalidDecisionValue' })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toBe('Validation failed');
    });

    it('POST /recommendations/:id/feedback returns 404 for unknown recommendation', async () => {
      const response = await request(app.getHttpServer())
        .post('/recommendations/00000000-0000-0000-0000-000000000000/feedback')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ decision: 'Discard' })
        .expect(404);

      expect(response.body.statusCode).toBe(404);
    });

    it('DELETE /recommendations/:id/feedback returns 404 for unknown recommendation', async () => {
      const response = await request(app.getHttpServer())
        .delete(
          '/recommendations/00000000-0000-0000-0000-000000000000/feedback',
        )
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
    });

    it('Watchlist and Summary endpoints: POST/DELETE watch, GET watches, GET summary', async () => {
      const profId = asProfileId('00000000-0000-0000-0000-000000000022');
      const oppId = asOpportunityId('opp-watch-e2e');
      await seedProfile(pool, '00000000-0000-0000-0000-000000000022');
      await seedOpportunity(pool, 'opp-watch-e2e');

      // 1. Summary before adding watch
      const summary1 = await request(app.getHttpServer())
        .get(`/profiles/${profId}/summary`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(summary1.body.watching).toBe(0);
      expect(summary1.body.unreadAlerts).toBe(0);

      // 2. Add watch via POST /profiles/:id/watches/:opportunityId
      await request(app.getHttpServer())
        .post(`/profiles/${profId}/watches/${oppId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // 3. GET watches
      const watchesRes = await request(app.getHttpServer())
        .get(`/profiles/${profId}/watches?page=1&pageSize=10`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(watchesRes.body.total).toBe(1);
      expect(watchesRes.body.items).toHaveLength(1);
      expect(watchesRes.body.items[0].opportunity.id).toBe(oppId);
      expect(watchesRes.body.items[0]).toHaveProperty('last10Changes');
      expect(watchesRes.body.items[0]).toHaveProperty('addedAt');

      // 4. Summary after watch
      const summary2 = await request(app.getHttpServer())
        .get(`/profiles/${profId}/summary`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(summary2.body.watching).toBe(1);

      // 5. Remove watch via DELETE /profiles/:id/watches/:opportunityId
      await request(app.getHttpServer())
        .delete(`/profiles/${profId}/watches/${oppId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const summary3 = await request(app.getHttpServer())
        .get(`/profiles/${profId}/summary`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(summary3.body.watching).toBe(0);
    });

    it('Watchlist and Summary endpoints return 404 for non-existent profile', async () => {
      await request(app.getHttpServer())
        .get('/profiles/00000000-0000-0000-0000-000000000000/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get('/profiles/00000000-0000-0000-0000-000000000000/watches')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .post('/profiles/00000000-0000-0000-0000-000000000000/watches/opp-1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .delete('/profiles/00000000-0000-0000-0000-000000000000/watches/opp-1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('AlertController & Alert Inbox (P5.4)', () => {
    const alertProfileId = 'c0000000-0000-0000-0000-000000000001';
    const alertOppId = 'b0000000-0000-0000-0000-000000000001';
    const alert1Id = 'a0000000-0000-0000-0000-000000000001';
    const alert2Id = 'a0000000-0000-0000-0000-000000000002';

    beforeAll(async () => {
      await seedProfile(
        pool,
        alertProfileId,
        '00000000-0000-0000-0000-000000000001',
      );
      await seedOpportunity(pool, alertOppId);
      await pool.query(
        `UPDATE opportunities
         SET title = 'Construcción Hospital Central',
             contracting_entity_name = 'Secretaría de Salud',
             amount = 500000000,
             closing_date = '2026-11-15T15:00:00.000Z'
         WHERE id = $1;`,
        [alertOppId],
      );

      await pool.query('DELETE FROM alerts WHERE profile_id = $1;', [
        alertProfileId,
      ]);

      await alertRepo.save({
        id: asAlertId(alert1Id),
        profileId: asProfileId(alertProfileId),
        opportunityId: asOpportunityId(alertOppId),
        trigger: 'Amendment',
        changeKey: 'amount:2026-10-18',
        attempts: 0,
        lastError: null,
        readAt: null,
        deliveredAt: null,
      });

      await alertRepo.save({
        id: asAlertId(alert2Id),
        profileId: asProfileId(alertProfileId),
        opportunityId: asOpportunityId(alertOppId),
        trigger: 'DeadlineApproaching',
        changeKey: 'deadline:2026-11-15',
        attempts: 0,
        lastError: null,
        readAt: null,
        deliveredAt: null,
      });
    });

    it('GET /profiles/:id/alerts returns paginated list of alerts with opportunitySummary', async () => {
      const res = await request(app.getHttpServer())
        .get(`/profiles/${alertProfileId}/alerts?page=1&pageSize=10`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(10);
      expect(res.body.items).toHaveLength(2);

      const item = res.body.items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('trigger');
      expect(item).toHaveProperty('changeKey');
      expect(item).toHaveProperty('createdAt');
      expect(item.readAt).toBeNull();
      expect(item.opportunitySummary).toEqual({
        id: alertOppId,
        title: 'Construcción Hospital Central',
        entity: 'Secretaría de Salud',
        amount: 500000000,
        closingDate: '2026-11-15T15:00:00.000Z',
      });
    });

    it('GET /profiles/:id/summary reflects real unreadAlerts count', async () => {
      const res = await request(app.getHttpServer())
        .get(`/profiles/${alertProfileId}/summary`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.unreadAlerts).toBe(2);
    });

    it('POST /alerts/:id/read marks an alert as read and is idempotent', async () => {
      const markRes = await request(app.getHttpServer())
        .post(`/alerts/${alert1Id}/read`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(markRes.body.success).toBe(true);

      // Verify unread count in summary decreased to 1
      const summaryRes = await request(app.getHttpServer())
        .get(`/profiles/${alertProfileId}/summary`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      expect(summaryRes.body.unreadAlerts).toBe(1);

      // Idempotent: marking again still succeeds
      const idempotentRes = await request(app.getHttpServer())
        .post(`/alerts/${alert1Id}/read`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      expect(idempotentRes.body.success).toBe(true);
    });

    it('POST /alerts/:id/read returns 404 for unknown alert', async () => {
      await request(app.getHttpServer())
        .post('/alerts/00000000-0000-0000-0000-000000000000/read')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('POST /profiles/:id/alerts/read-all marks all unread alerts for profile as read', async () => {
      const res = await request(app.getHttpServer())
        .post(`/profiles/${alertProfileId}/alerts/read-all`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.markedCount).toBe(1); // since alert1 was already read, only alert2 was unread

      // Summary unread count should now be 0
      const summaryRes = await request(app.getHttpServer())
        .get(`/profiles/${alertProfileId}/summary`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      expect(summaryRes.body.unreadAlerts).toBe(0);
    });
  });

  describe('AuthController & Authentication Guard', () => {
    const testUser = {
      email: 'contratista.test@empresa.com.co',
      password: 'SecurePassword123!',
    };
    let registeredUserId: string;
    let authAccessToken: string;
    let authRefreshToken: string;

    it('POST /auth/register creates user and returns 201 with id and lowercase email', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: '  Contratista.Test@Empresa.Com.CO  ',
          password: testUser.password,
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.email).toBe(testUser.email);
      expect(response.body.password).toBeUndefined();
      expect(response.body.passwordHash).toBeUndefined();
      registeredUserId = response.body.id;
    });

    it('POST /auth/register rejects password shorter than 10 characters with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'short.pass@empresa.com',
          password: 'short',
        })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.error).toBe('ValidationError');
    });

    it('POST /auth/register rejects duplicate email with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser)
        .expect(400);

      expect(response.body.statusCode).toBe(400);
    });

    it('POST /auth/login returns accessToken and refreshToken on valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send(testUser)
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
      authAccessToken = response.body.accessToken;
      authRefreshToken = response.body.refreshToken;

      // Verify accessToken payload
      const decoded = jwtService.verify(authAccessToken);
      expect(decoded.sub).toBe(registeredUserId);
      expect(decoded.role).toBe('user');
    });

    it('POST /auth/login returns identical 401 message for wrong email and wrong password', async () => {
      const wrongEmailRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nonexistent@user.com', password: testUser.password })
        .expect(401);

      const wrongPassRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'WrongPassword999!' })
        .expect(401);

      expect(wrongEmailRes.body.message).toBe('Invalid email or password');
      expect(wrongPassRes.body.message).toBe('Invalid email or password');
    });

    it('POST /auth/login throttles after 5 failed attempts per email and IP with 429', async () => {
      const throttledEmail = 'throttled.target@pliegos.com';
      // Register user first
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: throttledEmail, password: 'ValidPassword123!' })
        .expect(201);

      // 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .set('X-Forwarded-For', '192.168.100.50')
          .send({ email: throttledEmail, password: 'WrongPassword123!' })
          .expect(401);
      }

      // 6th attempt should be blocked with 429
      const throttledRes = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', '192.168.100.50')
        .send({ email: throttledEmail, password: 'ValidPassword123!' })
        .expect(429);

      expect(throttledRes.body.message).toContain(
        'Too many failed login attempts',
      );
    });

    it('POST /auth/refresh performs token rotation and rejects reused old refresh token', async () => {
      // Refresh with authRefreshToken
      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: authRefreshToken })
        .expect(200);

      expect(refreshRes.body.accessToken).toBeDefined();
      expect(refreshRes.body.refreshToken).toBeDefined();
      expect(refreshRes.body.refreshToken).not.toBe(authRefreshToken);

      const newRefreshToken = refreshRes.body.refreshToken;

      // Reusing old refreshToken should return 401
      const reuseRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: authRefreshToken })
        .expect(401);

      expect(reuseRes.body.message).toContain(
        'Refresh token has already been revoked',
      );

      // Refreshing with an unknown token returns 401 with invalid or expired message
      const unknownRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({
          refreshToken:
            '0000000000000000000000000000000000000000000000000000000000000000',
        })
        .expect(401);

      expect(unknownRes.body.message).toContain(
        'Invalid or expired refresh token',
      );

      // Refreshing with the new token works
      const secondRefreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: newRefreshToken })
        .expect(200);

      expect(secondRefreshRes.body.accessToken).toBeDefined();
      authRefreshToken = secondRefreshRes.body.refreshToken;
    });

    it('POST /auth/logout revokes refresh token so subsequent refresh fails with 401', async () => {
      // Logout
      const logoutRes = await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: authRefreshToken })
        .expect(200);

      expect(logoutRes.body.success).toBe(true);

      // Subsequent refresh fails with 401
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: authRefreshToken })
        .expect(401);
    });

    it('GET /auth/me returns 401 without token and 200 with user data when authenticated', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);

      const meRes = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${authAccessToken}`)
        .expect(200);

      expect(meRes.body).toHaveProperty('id', registeredUserId);
      expect(meRes.body).toHaveProperty('email', testUser.email);
      expect(meRes.body).toHaveProperty('role', 'user');
    });

    it('Global AuthGuard enforces authentication on protected routes and permits public routes', async () => {
      // 1. Missing authorization header gives 401
      const unauthRes = await request(app.getHttpServer())
        .get('/opportunities')
        .expect(401);

      expect(unauthRes.body.message).toBe(
        'Missing or invalid authorization header',
      );

      // 2. Malformed token gives 401
      const malformedRes = await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', 'Bearer not-a-valid-jwt')
        .expect(401);

      expect(malformedRes.body.message).toBe('Invalid or expired token');

      // 3. Expired token gives 401
      const expiredRes = await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(expiredRes.body.message).toBe('Invalid or expired token');

      // 4. Valid token succeeds
      await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // 5. Public routes succeed without authorization header
      await request(app.getHttpServer()).get('/api-json').expect(200);

      await request(app.getHttpServer()).get('/reference').expect(200);
    });
  });

  describe('Resource Ownership & Multi-user Isolation (P4.2)', () => {
    let tokenUserA: string;
    let tokenUserB: string;
    let profileAId: string;
    let recAId: string;
    const oppIsoId = 'opp-iso-42-01';

    beforeAll(async () => {
      // 1. Register User A and User B
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'userA.isolation@pliegos.test',
          password: 'PasswordUserA123!',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'userB.isolation@pliegos.test',
          password: 'PasswordUserB123!',
        })
        .expect(201);

      // Login to get tokens
      const loginA = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'userA.isolation@pliegos.test',
          password: 'PasswordUserA123!',
        })
        .expect(200);
      tokenUserA = loginA.body.accessToken;

      const loginB = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'userB.isolation@pliegos.test',
          password: 'PasswordUserB123!',
        })
        .expect(200);
      tokenUserB = loginB.body.accessToken;

      // Seed opportunity for recommendations and watches
      await seedOpportunity(pool, oppIsoId);

      // User A creates Profile A
      const createProfA = await request(app.getHttpServer())
        .post('/profiles')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          name: 'Perfil Aislamiento Usuario A',
          contactEmail: 'userA.isolation@pliegos.test',
          alertsEnabled: true,
          deadlineAlertDays: 3,
          sector: 'Tecnología',
          capabilities: [{ name: 'Desarrollo', yearsOfExperience: 5 }],
          preferences: {
            categoryCodes: ['V1.80111600'],
            keywords: ['software'],
            amountRange: { min: 10000000, max: 200000000 },
            departments: ['Cundinamarca'],
          },
        })
        .expect(201);
      profileAId = createProfA.body.id;

      // Seed recommendation for Profile A and oppIsoId
      recAId = '00000000-0000-0000-0000-000000000042';
      const scoreResult = createRelevanceScore(0.95);
      if (!scoreResult.ok) throw new Error(scoreResult.error.message);
      const recResult = createRecommendation({
        id: asRecommendationId(recAId),
        profileId: asProfileId(profileAId),
        opportunityId: asOpportunityId(oppIsoId),
        score: scoreResult.value,
        explanation: {
          summary: 'Gran compatibilidad',
          matchedFactors: [
            {
              factor: 'semanticSimilarity',
              score: 0.95,
              description: 'Alta afinidad',
            },
          ],
        },
      });
      if (!recResult.ok) throw new Error(recResult.error.message);
      await recRepo.save(recResult.value);

      // User A adds a watch on oppIsoId
      await request(app.getHttpServer())
        .post(`/profiles/${profileAId}/watches/${oppIsoId}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(200);
    });

    it('User B gets 404 when attempting to read User A profile (GET /profiles/:id)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/profiles/${profileAId}`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(404);
      expect(res.body.error).toBe('ProfileNotFoundError');
    });

    it('User B gets 404 when attempting to update User A profile (PUT /profiles/:id)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/profiles/${profileAId}`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({
          name: 'Perfil Modificado Ilícitamente',
          contactEmail: 'userB@pliegos.test',
          alertsEnabled: false,
          deadlineAlertDays: 1,
          sector: 'Hacked',
          capabilities: [],
          preferences: {
            categoryCodes: [],
            keywords: [],
            amountRange: { min: 0, max: 100 },
            departments: ['Bogota'],
          },
        })
        .expect(404);
      expect(res.body.error).toBe('ProfileNotFoundError');
    });

    it('User B gets 404 when attempting to delete User A profile (DELETE /profiles/:id)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/profiles/${profileAId}`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(404);
      expect(res.body.error).toBe('ProfileNotFoundError');
    });

    it('User B gets 404 when accessing recommendations of User A profile (GET /profiles/:id/recommendations)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/profiles/${profileAId}/recommendations`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(404);
      expect(res.body.error).toBe('ProfileNotFoundError');
    });

    it('User B gets 404 when accessing watches of User A profile (GET /profiles/:id/watches)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/profiles/${profileAId}/watches`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(404);
      expect(res.body.error).toBe('ProfileNotFoundError');
    });

    it('User B gets 404 when adding watch to User A profile (POST /profiles/:id/watches/:opportunityId)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/profiles/${profileAId}/watches/${oppIsoId}`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(404);
      expect(res.body.error).toBe('ProfileNotFoundError');
    });

    it('User B gets 404 when deleting watch from User A profile (DELETE /profiles/:id/watches/:opportunityId)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/profiles/${profileAId}/watches/${oppIsoId}`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(404);
      expect(res.body.error).toBe('ProfileNotFoundError');
    });

    it('User B gets 404 when accessing summary of User A profile (GET /profiles/:id/summary)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/profiles/${profileAId}/summary`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(404);
      expect(res.body.error).toBe('ProfileNotFoundError');
    });

    it('User B gets 404 when submitting feedback on User A recommendation (POST /recommendations/:id/feedback)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/recommendations/${recAId}/feedback`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ decision: 'Participate' })
        .expect(404);
      expect(res.body.error).toBe('RecommendationNotFoundError');
    });

    it('User B gets 404 when undoing feedback on User A recommendation (DELETE /recommendations/:id/feedback)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/recommendations/${recAId}/feedback`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(404);
      expect(res.body.error).toBe('RecommendationNotFoundError');
    });

    it('User B gets 404 when attempting to read User A alerts (GET /profiles/:id/alerts)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/profiles/${profileAId}/alerts`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(404);
      expect(res.body.error).toBe('ProfileNotFoundError');
    });

    it('User B gets 404 when attempting to mark read an alert belonging to User A (POST /alerts/:id/read)', async () => {
      const alertIsoId = 'a1111111-1111-1111-1111-111111111111';
      await alertRepo.save({
        id: asAlertId(alertIsoId),
        profileId: asProfileId(profileAId),
        opportunityId: asOpportunityId(oppIsoId),
        trigger: 'Amendment',
        changeKey: 'amount',
        attempts: 0,
        lastError: null,
        readAt: null,
        deliveredAt: null,
      });

      const res = await request(app.getHttpServer())
        .post(`/alerts/${alertIsoId}/read`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(404);
      expect(res.body.error).toBe('ProfileNotFoundError');
    });

    it('User B gets 404 when attempting to mark all read on User A profile (POST /profiles/:id/alerts/read-all)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/profiles/${profileAId}/alerts/read-all`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(404);
      expect(res.body.error).toBe('ProfileNotFoundError');
    });

    it('GET /profiles returns isolated profiles for each user', async () => {
      const resA = await request(app.getHttpServer())
        .get('/profiles')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(200);
      expect(resA.body.items).toHaveLength(1);
      expect(resA.body.items[0].id).toBe(profileAId);
      expect(resA.body.total).toBe(1);

      const resB = await request(app.getHttpServer())
        .get('/profiles')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(200);
      expect(resB.body.items).toHaveLength(0);
      expect(resB.body.total).toBe(0);
    });

    it('Enforces MAX_PROFILES_PER_USER: 5 profiles succeed, 6th is rejected with 400', async () => {
      for (let i = 1; i <= 5; i++) {
        await request(app.getHttpServer())
          .post('/profiles')
          .set('Authorization', `Bearer ${tokenUserB}`)
          .send({
            name: `Perfil Usuario B #${i}`,
            contactEmail: `userB.${i}@pliegos.test`,
            alertsEnabled: true,
            deadlineAlertDays: 3,
            sector: 'Tecnología',
            capabilities: [],
            preferences: {
              categoryCodes: [],
              keywords: ['software'],
              amountRange: { min: 1000, max: 2000 },
              departments: ['Antioquia'],
            },
          })
          .expect(201);
      }

      // 6th profile creation attempt should fail with 400 (ValidationError)
      const res6th = await request(app.getHttpServer())
        .post('/profiles')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({
          name: 'Perfil Usuario B #6 Excedente',
          contactEmail: 'userB.6@pliegos.test',
          alertsEnabled: true,
          deadlineAlertDays: 3,
          sector: 'Tecnología',
          capabilities: [],
          preferences: {
            categoryCodes: [],
            keywords: ['software'],
            amountRange: { min: 1000, max: 2000 },
            departments: ['Antioquia'],
          },
        })
        .expect(400);

      expect(res6th.body.error).toBe('ValidationError');
      expect(res6th.body.message).toContain('Maximum profiles limit reached');

      // Verify GET /profiles for User B returns exactly 5 profiles
      const listB = await request(app.getHttpServer())
        .get('/profiles')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(200);
      expect(listB.body.items).toHaveLength(5);
      expect(listB.body.total).toBe(5);
    });
  });

  describe('Admin Routes & Operational Hardening (P4.3)', () => {
    let normalUserToken: string;
    let createdJobId: string;

    beforeAll(async () => {
      // Register a normal user (role: 'user')
      await request(app.getHttpServer())
        .post('/auth/register')
        .set('X-Forwarded-For', '10.0.0.99')
        .send({
          email: 'normal.user.hardening@pliegos.test',
          password: 'Password12345!',
        })
        .expect(201);

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', '10.0.0.99')
        .send({
          email: 'normal.user.hardening@pliegos.test',
          password: 'Password12345!',
        })
        .expect(200);

      normalUserToken = login.body.accessToken;
    });

    it('returns Helmet security headers on responses', async () => {
      const res = await request(app.getHttpServer())
        .get('/opportunities')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-dns-prefetch-control']).toBe('off');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('unauthenticated requests to /admin/* return 401 Unauthorized', async () => {
      await request(app.getHttpServer()).post('/admin/sync').expect(401);
      await request(app.getHttpServer()).post('/admin/alerts/run').expect(401);
      await request(app.getHttpServer())
        .post('/admin/recommendations/refresh')
        .expect(401);
      await request(app.getHttpServer())
        .get('/admin/jobs/00000000-0000-0000-0000-000000000001')
        .expect(401);
      await request(app.getHttpServer()).get('/admin/metrics').expect(401);
      await request(app.getHttpServer()).get('/admin/pipeline').expect(401);
    });

    it('normal user (role: user) gets 403 Forbidden on all /admin/* routes', async () => {
      const resSync = await request(app.getHttpServer())
        .post('/admin/sync')
        .set('Authorization', `Bearer ${normalUserToken}`)
        .expect(403);
      expect(resSync.body.statusCode).toBe(403);

      const resAlerts = await request(app.getHttpServer())
        .post('/admin/alerts/run')
        .set('Authorization', `Bearer ${normalUserToken}`)
        .expect(403);
      expect(resAlerts.body.statusCode).toBe(403);

      const resRecs = await request(app.getHttpServer())
        .post('/admin/recommendations/refresh')
        .set('Authorization', `Bearer ${normalUserToken}`)
        .expect(403);
      expect(resRecs.body.statusCode).toBe(403);

      const resJobs = await request(app.getHttpServer())
        .get('/admin/jobs/00000000-0000-0000-0000-000000000001')
        .set('Authorization', `Bearer ${normalUserToken}`)
        .expect(403);
      expect(resJobs.body.statusCode).toBe(403);

      const resMetrics = await request(app.getHttpServer())
        .get('/admin/metrics')
        .set('Authorization', `Bearer ${normalUserToken}`)
        .expect(403);
      expect(resMetrics.body.statusCode).toBe(403);

      const resPipeline = await request(app.getHttpServer())
        .get('/admin/pipeline')
        .set('Authorization', `Bearer ${normalUserToken}`)
        .expect(403);
      expect(resPipeline.body.statusCode).toBe(403);
    });

    it('admin user enqueues POST /admin/sync and receives 202 { jobId }', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/sync')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ since: '2026-01-01T00:00:00.000Z' })
        .expect(202);

      expect(res.body.jobId).toBeDefined();
      expect(res.body.jobId).toMatch(/^[0-9a-f-]{36}$/i);
      createdJobId = res.body.jobId;
    });

    it('POST /admin/sync rejects invalid date with 400 (Zod)', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/sync')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ since: 'not-a-valid-date' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('admin user enqueues POST /admin/alerts/run and receives 202 { jobId }', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/alerts/run')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(202);

      expect(res.body.jobId).toBeDefined();
      expect(res.body.jobId).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('admin user enqueues POST /admin/recommendations/refresh and receives 202 { jobId }', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/recommendations/refresh')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(202);

      expect(res.body.jobId).toBeDefined();
      expect(res.body.jobId).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('GET /admin/jobs/:id returns job status for existing job and 404 for non-existent', async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/jobs/${createdJobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.jobId).toBe(createdJobId);
      expect(res.body.name).toBe('admin-sync');
      expect(res.body.status).toBeDefined();

      await request(app.getHttpServer())
        .get('/admin/jobs/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('admin user queries GET /admin/metrics and receives in-memory AI metrics report', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/metrics')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.overall).toBeDefined();
      expect(typeof res.body.overall.calls).toBe('number');
      expect(typeof res.body.overall.failures).toBe('number');
      expect(typeof res.body.overall.p50).toBe('number');
      expect(typeof res.body.overall.p95).toBe('number');
      expect(res.body.byFeature).toBeDefined();
    });

    it('admin user queries GET /admin/pipeline and receives recent pipeline runs array', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/pipeline')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('validates UUID on :id params rejecting non-uuid with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .get('/admin/jobs/not-a-valid-uuid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .get('/profiles/not-a-valid-uuid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .put('/profiles/not-a-valid-uuid')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          sector: 'Tecnología',
          capabilities: [],
          preferences: {
            categoryCodes: [],
            keywords: [],
            departments: ['Antioquia'],
          },
        })
        .expect(400);

      await request(app.getHttpServer())
        .delete('/profiles/not-a-valid-uuid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .post('/recommendations/not-a-valid-uuid/feedback')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ decision: 'Participate' })
        .expect(400);
    });

    it('rate limiting: 120 requests succeed, the 121st request in a minute gets 429', async () => {
      let got429 = false;
      for (let i = 0; i < 135; i++) {
        const res = await request(app.getHttpServer())
          .get('/opportunities')
          .set('Authorization', `Bearer ${authToken}`);
        if (res.status === 429) {
          got429 = true;
          expect(res.body.statusCode).toBe(429);
          break;
        }
      }
      expect(got429).toBe(true);
    });
  });
});
