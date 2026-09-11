import { Injectable, Logger } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type AuditAction =
  | 'auth.login'
  | 'auth.login.failed'
  | 'auth.register'
  | 'auth.password.reset'
  | 'admin.impersonate'
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
    return this._auditLog.model.auditLog
      .create({
        data: {
          action: entry.action,
          userId: entry.userId,
          organizationId: entry.organizationId,
          ip: entry.ip?.slice(0, 100),
          userAgent: entry.userAgent?.slice(0, 300),
          metadata: (entry.metadata as any) ?? undefined,
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
