import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from './database.tokens';
import { PgAdvisoryLock } from './pg-advisory-lock';
import { ENV, Env } from '../../../../config/env';

export { DATABASE_POOL };

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ENV],
      useFactory: (env: Env) => {
        const connectionString = env.DATABASE_URL;
        if (!connectionString) {
          throw new Error('DATABASE_URL is not set');
        }
        return new Pool({ connectionString });
      },
    },
    PgAdvisoryLock,
  ],
  exports: [DATABASE_POOL, PgAdvisoryLock],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onModuleDestroy() {
    // Graceful closure handled when process terminates
  }
}
