import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  hasSecrets,
  redactSecretsInJson,
} from '@gitroom/nestjs-libraries/services/redact.secrets';

const UNKNOWN_TOKEN = 'An unknown error occurred';

interface ListErrorsParams {
  page?: number;
  limit?: number;
  platform?: string;
  email?: string;
  unknownFirst?: boolean;
  days?: number;
}

@Injectable()
export class ErrorsRepository {
  constructor(private _errors: PrismaRepository<'errors'>) {}

  private buildWhere(params: ListErrorsParams) {
    const where: any = {};
    if (params.platform) {
      where.platform = params.platform;
    }
    if (params.email) {
      where.organization = {
        users: {
          some: {
            user: {
              email: { contains: params.email, mode: 'insensitive' },
            },
          },
        },
      };
    }
    if (params.days && params.days > 0) {
      where.createdAt = {
        gte: new Date(Date.now() - params.days * 24 * 60 * 60 * 1000),
      };
    }
    return where;
  }

  private get include() {
    return {
      organization: {
        select: {
          id: true,
          name: true,
          users: {
            select: {
              user: { select: { id: true, email: true, name: true } },
            },
          },
        },
      },
      post: { select: { id: true, content: true } },
    } as const;
  }

  async listPlatforms() {
    const rows = await this._errors.model.errors.findMany({
      distinct: ['platform'],
      select: { platform: true },
      orderBy: { platform: 'asc' },
    });
    return rows.map((r) => r.platform);
  }

  /**
   * Rows written before E2E-09-01 was fixed still hold plaintext channel
   * tokens, and the panel renders `body` under "View" and copies it with "Copy
   * Debug Code". Redacting on the way out keeps those rows readable without
   * waiting for the backfill, and keeps the guarantee if anything ever writes
   * to this table without going through `changeState`.
   */
  private redact<T extends { message: string; body: string }>(rows: T[]): T[] {
    return rows.map((row) => ({
      ...row,
      message: redactSecretsInJson(row.message),
      body: redactSecretsInJson(row.body),
    }));
  }

  async listErrors(params: ListErrorsParams) {
    const page = Math.max(0, params.page || 0);
    const limit = Math.min(Math.max(1, params.limit || 20), 100);
    const skip = page * limit;
    const where = this.buildWhere(params);
    const include = this.include;

    if (!params.unknownFirst) {
      const [items, total] = await Promise.all([
        this._errors.model.errors.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include,
        }),
        this._errors.model.errors.count({ where }),
      ]);
      return {
        items: this.redact(items),
        total,
        page,
        limit,
        hasMore: skip + items.length < total,
      };
    }

    const unknownWhere = { ...where, message: { contains: UNKNOWN_TOKEN } };
    const knownWhere = {
      ...where,
      NOT: { message: { contains: UNKNOWN_TOKEN } },
    };

    const [unknownTotal, knownTotal] = await Promise.all([
      this._errors.model.errors.count({ where: unknownWhere }),
      this._errors.model.errors.count({ where: knownWhere }),
    ]);

    let unknownItems: any[] = [];
    let knownItems: any[] = [];

    if (skip < unknownTotal) {
      const takeUnknown = Math.min(unknownTotal - skip, limit);
      unknownItems = await this._errors.model.errors.findMany({
        where: unknownWhere,
        orderBy: { createdAt: 'desc' },
        skip,
        take: takeUnknown,
        include,
      });
      const remaining = limit - unknownItems.length;
      if (remaining > 0) {
        knownItems = await this._errors.model.errors.findMany({
          where: knownWhere,
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: remaining,
          include,
        });
      }
    } else {
      knownItems = await this._errors.model.errors.findMany({
        where: knownWhere,
        orderBy: { createdAt: 'desc' },
        skip: skip - unknownTotal,
        take: limit,
        include,
      });
    }

    const items = [...unknownItems, ...knownItems];
    const total = unknownTotal + knownTotal;
    return {
      items: this.redact(items),
      total,
      page,
      limit,
      hasMore: skip + items.length < total,
    };
  }

  /**
   * Rewrite the rows that already hold plaintext credentials.
   *
   * Redacting on read (see `redact`) stops the panel handing a token out, but
   * the value is still sitting in the database and in every backup taken since
   * it was written. This is the one-off that removes it. Batched by cursor
   * because the table has no retention and only grows (E2E-09-58).
   */
  async scrubSecrets(apply: boolean) {
    const BATCH = 500;
    let cursor: string | undefined;
    let scanned = 0;
    const dirty: { id: string; platform: string; createdAt: Date }[] = [];

    for (;;) {
      const rows = await this._errors.model.errors.findMany({
        select: {
          id: true,
          message: true,
          body: true,
          platform: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (!rows.length) {
        break;
      }

      scanned += rows.length;
      cursor = rows[rows.length - 1].id;

      for (const row of rows) {
        if (!hasSecrets(row.body) && !hasSecrets(row.message)) {
          continue;
        }

        dirty.push({
          id: row.id,
          platform: row.platform,
          createdAt: row.createdAt,
        });

        if (apply) {
          await this._errors.model.errors.update({
            where: { id: row.id },
            data: {
              message: redactSecretsInJson(row.message),
              body: redactSecretsInJson(row.body),
            },
          });
        }
      }

      if (rows.length < BATCH) {
        break;
      }
    }

    return { scanned, dirty };
  }
}
