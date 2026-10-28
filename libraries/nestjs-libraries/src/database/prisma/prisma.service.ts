import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { existsSync } from 'fs';

// With sslmode=require Prisma encrypts but does not check the server's
// certificate (on production 2026-10-28: sslaccept=strict without a CA failed,
// so nothing had been verifying). DATABASE_CA_FILE names the database's root
// CA, one certificate per file: Prisma reads only the first one of a bundle.
// Set and missing is a misconfiguration, so it stops the start instead of
// quietly connecting unverified. Mastra's pg pool takes its own URL
// (chat/pg-connection.ts); scripts/db-migrate.mjs does the same as this.
export function verifiedDatabaseUrl(url: string | undefined): string | undefined {
  const ca = process.env.DATABASE_CA_FILE;
  if (!url || !ca || url.includes('sslaccept=')) {
    return url;
  }
  if (!existsSync(ca)) {
    throw new Error(`DATABASE_CA_FILE ${ca} does not exist`);
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}sslaccept=strict&sslcert=${ca}`;
}

// Prisma's default pool is `2 * cpus + 1` connections PER PROCESS; with three
// pm2 workers plus the orchestrator that overruns a small RDS instance. Cap
// the pool explicitly unless the DATABASE_URL already sets one.
function pooledDatabaseUrl(): string | undefined {
  const url = verifiedDatabaseUrl(process.env.DATABASE_URL);
  if (!url || url.includes('connection_limit=')) {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=${
    process.env.DATABASE_CONNECTION_LIMIT || 5
  }&pool_timeout=10`;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: {
          url: pooledDatabaseUrl(),
        },
      },
    });
  }
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Injectable()
export class PrismaRepository<T extends keyof PrismaService> {
  public model: Pick<PrismaService, T>;
  constructor(private _prismaService: PrismaService) {
    this.model = this._prismaService;
  }
}

@Injectable()
export class PrismaTransaction {
  public model: Pick<PrismaService, '$transaction'>;
  constructor(private _prismaService: PrismaService) {
    this.model = this._prismaService;
  }
}
