import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { EnvValidationError, loadEnv } from './config/env';
import { StructuredLoggerService } from './modules/shared/infrastructure/logging/structured-logger.service';

async function bootstrap() {
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

  const structuredLogger = new StructuredLoggerService({
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
  });

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: structuredLogger,
  });
  app.useLogger(structuredLogger);
  app.enableShutdownHooks();

  const logger = new Logger('Worker');
  logger.log('Pliegos Worker running in application context');
}

bootstrap();
