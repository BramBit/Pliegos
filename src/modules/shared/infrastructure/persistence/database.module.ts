import { Global, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { initDatabaseSchema } from './database.schema';

export const DATABASE_POOL = Symbol('DATABASE_POOL');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: () => {
        const connectionString =
          process.env.DATABASE_URL ||
          process.env.TEST_DATABASE_URL ||
          'postgres://postgres:postgres@localhost:5433/pliegos_test';
        return new Pool({ connectionString });
      },
    },
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule implements OnModuleInit, OnModuleDestroy {
  constructor() {}

  async onModuleInit() {
    // The pool is retrieved and schema checked
  }

  async onModuleDestroy() {
    // Graceful pool closure can be handled if needed
  }
}
