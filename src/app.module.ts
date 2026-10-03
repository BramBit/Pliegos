import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './modules/shared/infrastructure/persistence/database.module';
import { OpportunityModule } from './modules/opportunity/opportunity.module';
import { ProfileModule } from './modules/profile/profile.module';
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { AlertModule } from './modules/alert/alert.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    OpportunityModule,
    ProfileModule,
    RecommendationModule,
    AlertModule,
  ],
})
export class AppModule {}
