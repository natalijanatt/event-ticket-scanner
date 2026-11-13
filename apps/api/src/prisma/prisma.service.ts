import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppConfig } from '../config/app-config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly schemaName: string;

  constructor(config: AppConfig) {
    super({ datasources: { db: { url: config.databaseUrl } } });
    this.schemaName = config.dbSchema;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Schema-qualified identifier for raw SQL, e.g. `"app"."tickets"`.
   * Raw queries must not rely on `search_path`, which is not guaranteed
   * behind a transaction-mode pooler (Supabase / PgBouncer).
   */
  ident(name: string): Prisma.Sql {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
    return Prisma.raw(`"${this.schemaName}"."${name}"`);
  }
}
