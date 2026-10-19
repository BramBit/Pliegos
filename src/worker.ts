import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { EnvValidationError, loadEnv } from './config/env';

async function bootstrap() {
  const logger = new Logger('Worker');

  try {
    loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error('Invalid environment configuration:');
      for (const problem of error.problems) console.error(problem);
      process.exit(1);
    }
    throw error;
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();

  logger.log('Pliegos Worker running in application context');
}

bootstrap();
