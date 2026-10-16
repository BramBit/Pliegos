import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from './modules/shared/infrastructure/persistence/database.module';
import { OpportunityModule } from './modules/opportunity/opportunity.module';
import { ProfileModule } from './modules/profile/profile.module';
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { AlertModule } from './modules/alert/alert.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        maxRetriesPerRequest: null,
      },
    }),
    DatabaseModule,
    OpportunityModule,
    ProfileModule,
    RecommendationModule,
    AlertModule,
    SchedulerModule,
  ],
})
export class AppModule {}
