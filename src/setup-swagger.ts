import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

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

  const document = SwaggerModule.createDocument(app, config);

  // Exponer el JSON OpenAPI crudo exclusivamente en /api-json
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/api-json', (_req: any, res: any) => {
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
