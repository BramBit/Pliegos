import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { HealthController } from './infrastructure/controllers/health.controller';
import { DatabaseModule } from '../shared/infrastructure/persistence/database.module';
import { GracefulShutdownService } from './infrastructure/lifecycle/graceful-shutdown.service';

@Module({
  imports: [DatabaseModule, DiscoveryModule],
  controllers: [HealthController],
  providers: [GracefulShutdownService],
  exports: [GracefulShutdownService],
})
export class HealthModule {}
