import { Module, Global } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Pool } from 'pg';
import { DATABASE_POOL, DatabaseModule } from '../shared/infrastructure/persistence/database.module';
import { USER_REPOSITORY_PORT } from './domain/ports/user.repository.port';
import { PostgresUserRepository } from './infrastructure/adapters/persistence/postgres-user.repository';
import { LoginThrottlerService } from './infrastructure/security/login-throttler.service';
import { AuthGuard } from './infrastructure/security/auth.guard';
import { RolesGuard } from './infrastructure/security/roles.guard';
import { AuthController } from './infrastructure/controllers/auth.controller';
import { RegisterUseCase } from './application/use-cases/register.use-case';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { RefreshTokenUseCase } from './application/use-cases/refresh-token.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { ENV, Env } from '../../config/env';

@Global()
@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ENV],
      useFactory: (env: Env) => {
        return {
          secret: env.JWT_SECRET,
          signOptions: { expiresIn: env.JWT_ACCESS_TTL as any },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    {
      provide: USER_REPOSITORY_PORT,
      useFactory: (pool: Pool) => new PostgresUserRepository(pool),
      inject: [DATABASE_POOL],
    },
    LoginThrottlerService,
    RegisterUseCase,
    LoginUseCase,
    RefreshTokenUseCase,
    LogoutUseCase,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [
    USER_REPOSITORY_PORT,
    JwtModule,
    LoginThrottlerService,
    RegisterUseCase,
    LoginUseCase,
    RefreshTokenUseCase,
    LogoutUseCase,
  ],
})
export class AuthModule {}
