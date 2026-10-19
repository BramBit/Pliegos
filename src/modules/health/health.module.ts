import { Module } from '@nestjs/common';
import { HealthController } from './infrastructure/controllers/health.controller';
import { DatabaseModule } from '../shared/infrastructure/persistence/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
})
export class HealthModule {}
