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
  | 'integration.connect'
  | 'integration.disconnect'
  | 'subscription.comp'
  | 'subscription.change'
  | 'subscription.delete'
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
  constructor(private _auditLog: PrismaRepository<'auditLog'>) {}

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
}
