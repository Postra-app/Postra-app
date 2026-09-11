import { Injectable, Logger } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { currentAuditActor } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.actor';

export type AuditAction =
  | 'auth.login'
  | 'auth.login.failed'
  | 'auth.register'
  | 'auth.password.reset'
  | 'admin.impersonate'
  | 'admin.impersonate.stop'
  | 'admin.grant-lifetime'
  | 'admin.grant-admin'
  | 'admin.revoke-admin'
  | 'admin.announcement.create'
  | 'admin.announcement.delete'
  | 'integration.connect'
  | 'integration.disconnect'
  | 'subscription.comp'
  | 'subscription.revoke'
  | 'subscription.change'
  | 'subscription.delete'
  | 'subscription.cancel'
  | 'billing.refund'
  | 'admin.delete-user'
  | 'admin.delete-organization'
  | 'admin.retention.purge'
  | 'security.apikey.rotate';

export interface AuditEntry {
  action: AuditAction;
  userId?: string;
  organizationId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  // The reader resolves actor, target and organization to names, so this
  // repository spans those three models. PrismaRepository only narrows the
  // type — `model` is the client itself at runtime.
  constructor(
    private _auditLog: PrismaRepository<'auditLog' | 'user' | 'organization'>
  ) {}

  // Fire-and-forget: the audit trail must never fail or slow the audited
  // action itself. Await it only in tests.
  record(entry: AuditEntry) {
    const actor = currentAuditActor();

    // While a session is impersonating, the caller's `user` is the target, so
    // an explicit userId here names the wrong person. The authenticated
    // identity from the JWT wins, and the target is recorded beside it
    // (E2E-09-35).
    const impersonatedUserId = actor?.impersonatedUserId;
    const userId = impersonatedUserId
      ? actor?.userId
      : entry.userId ?? actor?.userId;

    const metadata = impersonatedUserId
      ? { ...(entry.metadata ?? {}), impersonatedUserId }
      : entry.metadata;

    return this._auditLog.model.auditLog
      .create({
        data: {
          action: entry.action,
          userId,
          organizationId: entry.organizationId,
          ip: (entry.ip ?? actor?.ip)?.slice(0, 100),
          userAgent: (entry.userAgent ?? actor?.userAgent)?.slice(0, 300),
          metadata: (metadata as any) ?? undefined,
        },
      })
      .catch((e) =>
        Logger.warn(
          `Audit write failed (${entry.action}): ${
            e instanceof Error ? e.message : e
          }`
        )
      );
  }

  /**
   * Read the trail back.
   *
   * The writer was corrected first — the real admin as the actor, the target
   * beside them in `metadata`, `ip` and `userAgent` filled in — and then
   * nothing read any of it. An audit nobody can read is a table, not a
   * control: answering "who put this account on Business, and when" still
   * meant opening a psql session (E2E-09-34).
   *
   * Actor and target are resolved to email addresses here rather than in the
   * panel, in one query for the whole page, because the id alone tells the
   * person reading it nothing.
   */
  async list(options: {
    skip: number;
    limit: number;
    action?: string;
    userId?: string;
    organizationId?: string;
    from?: Date;
    to?: Date;
  }) {
    const where: Record<string, unknown> = {};
    if (options.action) {
      where.action = options.action;
    }
    if (options.userId) {
      where.userId = options.userId;
    }
    if (options.organizationId) {
      where.organizationId = options.organizationId;
    }
    if (options.from || options.to) {
      where.createdAt = {
        ...(options.from ? { gte: options.from } : {}),
        ...(options.to ? { lte: options.to } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this._auditLog.model.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: options.skip,
        take: options.limit,
      }),
      this._auditLog.model.auditLog.count({ where }),
    ]);

    // Every id the page mentions, actor and target alike, looked up once.
    const targetIds = rows
      .map((row) => {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        const target =
          metadata.impersonatedUserId ??
          metadata.targetUserId ??
          metadata.userId;
        return typeof target === 'string' ? target : null;
      })
      .filter((id): id is string => !!id);

    const ids = [
      ...new Set(
        [...rows.map((r) => r.userId), ...targetIds].filter(
          (id): id is string => !!id
        )
      ),
    ];

    const users = ids.length
      ? await this._auditLog.model.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, email: true, name: true },
        })
      : [];

    const byId = new Map<string, { email: string; name: string | null }>(
      users.map((u) => [u.id, { email: u.email, name: u.name }])
    );

    const orgIds = [
      ...new Set(rows.map((r) => r.organizationId).filter(Boolean)),
    ] as string[];
    const orgs = orgIds.length
      ? await this._auditLog.model.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : [];
    const orgById = new Map<string, string>(
      orgs.map((o) => [o.id, o.name])
    );

    return {
      total,
      items: rows.map((row) => {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        const rawTarget =
          metadata.impersonatedUserId ??
          metadata.targetUserId ??
          metadata.userId;
        const targetId = typeof rawTarget === 'string' ? rawTarget : null;

        return {
          id: row.id,
          action: row.action,
          createdAt: row.createdAt,
          ip: row.ip,
          userAgent: row.userAgent,
          metadata: row.metadata,
          actor: row.userId
            ? {
                id: row.userId,
                email: byId.get(row.userId)?.email ?? null,
                name: byId.get(row.userId)?.name ?? null,
              }
            : null,
          target: targetId
            ? {
                id: targetId,
                email:
                  byId.get(targetId)?.email ??
                  (typeof metadata.email === 'string' ? metadata.email : null),
              }
            : typeof metadata.email === 'string'
            ? { id: null, email: metadata.email }
            : null,
          organization: row.organizationId
            ? {
                id: row.organizationId,
                name: orgById.get(row.organizationId) ?? null,
              }
            : null,
        };
      }),
    };
  }

  /** The distinct actions present, so the filter offers real values only. */
  async listActions(): Promise<string[]> {
    const rows = await this._auditLog.model.auditLog.groupBy({
      by: ['action'],
      _count: { _all: true },
      orderBy: { action: 'asc' },
    });
    return rows.map((r: { action: string }) => r.action);
  }
}
