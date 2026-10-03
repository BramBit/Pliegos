import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { setupSwaggerAndScalar } from './setup-swagger';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  setupSwaggerAndScalar(app);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Pliegos API running on http://localhost:${port}`);
  logger.log(`Scalar API Reference available at http://localhost:${port}/reference`);
  logger.log(`OpenAPI JSON available at http://localhost:${port}/api-json`);
}

bootstrap();
