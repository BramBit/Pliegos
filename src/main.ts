import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { setupSwaggerAndScalar } from './setup-swagger';
import { setupSecurity } from './setup-app';
import { EnvValidationError, loadEnv } from './config/env';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error('Invalid environment configuration:');
      for (const problem of error.problems) console.error(problem);
      process.exit(1);
    }
    throw error;
  }

  const app = await NestFactory.create(AppModule);

  setupSecurity(app, { nodeEnv: env.NODE_ENV, corsOrigins: env.CORS_ORIGINS });
  setupSwaggerAndScalar(app);

  const port = env.PORT;
  await app.listen(port);
  logger.log(`Pliegos API running on http://localhost:${port}`);
  logger.log(`Scalar API Reference available at http://localhost:${port}/reference`);
  logger.log(`OpenAPI JSON available at http://localhost:${port}/api-json`);
}

bootstrap();
