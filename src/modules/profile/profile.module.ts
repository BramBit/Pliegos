import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../shared/infrastructure/persistence/database.module';
import { PROFILE_REPOSITORY_PORT } from './domain/ports/profile.repository.port';
import { PostgresProfileRepository } from './infrastructure/adapters/persistence/postgres-profile.repository';
import { ConfigureProfileUseCase } from './application/use-cases/configure-profile.use-case';
import { ProfileController } from './infrastructure/controllers/profile.controller';

@Module({
  controllers: [ProfileController],
  providers: [
    {
      provide: PROFILE_REPOSITORY_PORT,
      useFactory: (pool: Pool) => new PostgresProfileRepository(pool),
      inject: [DATABASE_POOL],
    },
    {
      provide: ConfigureProfileUseCase,
      useFactory: (repo) => new ConfigureProfileUseCase(repo),
      inject: [PROFILE_REPOSITORY_PORT],
    },
  ],
  exports: [PROFILE_REPOSITORY_PORT, ConfigureProfileUseCase],
})
export class ProfileModule {}
