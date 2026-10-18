import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { resolveRequestId } from './modules/shared/infrastructure/http/request-id.middleware';
import {
  AlertDto,
  AlertPageDto,
  ErrorEnvelopeDto,
  OpportunityDetail,
  OpportunitySummary,
  OpportunitySummaryPageDto,
  Page,
  ProfileDto,
  RecommendationDto,
  RecommendationPageDto,
  RegisterFeedbackResponseDto,
  ReviewFollowUpResponseDto,
  SyncOpportunitiesResponseDto,
} from './modules/shared/infrastructure/http/response.dtos';

export function setupSwaggerAndScalar(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Pliegos API')
    .setDescription(
      'Pliegos — Inteligencia de contratación pública. Descubre, analiza, prioriza con explicaciones y monitorea oportunidades de contratación estatal en Colombia (SECOP).',
    )
    .setVersion('1.0.0')
    .addTag('Opportunities', 'Ingesta desde SECOP II, normalización y búsqueda híbrida')
    .addTag('Profiles', 'Perfiles de contratistas, capacidades y preferencias')
    .addTag('Recommendations', 'Motor de priorización con explicaciones y registro de feedback')
    .addTag('Alerts', 'Monitoreo de adendas, fechas límite y notificaciones')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [
      OpportunitySummary,
      OpportunityDetail,
      RecommendationDto,
      ProfileDto,
      AlertDto,
      Page,
      OpportunitySummaryPageDto,
      RecommendationPageDto,
      AlertPageDto,
      ErrorEnvelopeDto,
      SyncOpportunitiesResponseDto,
      RegisterFeedbackResponseDto,
      ReviewFollowUpResponseDto,
    ],
  });

  // Exponer el JSON OpenAPI crudo exclusivamente en /api-json
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/api-json', (req: any, res: any) => {
    const reqId = resolveRequestId(req);
    res.setHeader('X-Request-Id', reqId);
    res.json(document);
  });

  // Montar Scalar en /reference como única interfaz interactiva
  app.use(
    '/reference',
    apiReference({
      pageTitle: 'Pliegos API Reference',
      spec: {
        content: document,
      },
    }),
  );

  return document;
}
