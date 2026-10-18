import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from './modules/shared/infrastructure/persistence/database.module';
import { OpportunityModule } from './modules/opportunity/opportunity.module';
import { ProfileModule } from './modules/profile/profile.module';
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { AlertModule } from './modules/alert/alert.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { AuthModule } from './modules/auth/auth.module';
import { GlobalExceptionFilter } from './modules/shared/infrastructure/http/global-exception.filter';
import { RequestIdMiddleware } from './modules/shared/infrastructure/http/request-id.middleware';

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
    AuthModule,
    OpportunityModule,
    ProfileModule,
    RecommendationModule,
    AlertModule,
    SchedulerModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
