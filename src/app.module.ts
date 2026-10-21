import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EnvModule, ENV, Env, isWorkerRole } from './config/env';
import { DatabaseModule } from './modules/shared/infrastructure/persistence/database.module';
import { OpportunityModule } from './modules/opportunity/opportunity.module';
import { ProfileModule } from './modules/profile/profile.module';
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { AlertModule } from './modules/alert/alert.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { GlobalExceptionFilter } from './modules/shared/infrastructure/http/global-exception.filter';
import { RequestIdMiddleware } from './modules/shared/infrastructure/http/request-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EnvModule,
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: {
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          maxRetriesPerRequest: null,
        },
      }),
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 120,
      },
    ]),
    DatabaseModule,
    AuthModule,
    OpportunityModule,
    ProfileModule,
    RecommendationModule,
    AlertModule,
    ...(isWorkerRole() ? [SchedulerModule] : []),
    AdminModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
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
