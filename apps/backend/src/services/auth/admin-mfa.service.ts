import { HttpException, Injectable } from '@nestjs/common';
import qrcode from 'qrcode-generator';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import {
  generateBackupCodes,
  generateTotpSecret,
  normalizeBackupCode,
  otpauthUri,
  verifyTotp,
} from '@gitroom/helpers/auth/totp';
import {
  ADMIN_MFA_LOCK_SECONDS,
  ADMIN_MFA_MAX_FAILURES,
  adminMfaFailuresKey,
} from '@gitroom/backend/services/auth/admin-mfa';

const ISSUER = 'Postra';

export type AdminMfaUser = {
  id: string;
  email: string;
  isSuperAdmin?: boolean;
  adminMfaPending?: boolean;
};

// The request carries the administrator flag lowered until the second step
// is done (auth.middleware.ts); either way this is a Postra administrator.
export const isAdministrator = (user: AdminMfaUser | undefined) =>
  !!user && (!!user.isSuperAdmin || !!user.adminMfaPending);

class TooManyAttempts extends HttpException {
  constructor() {
    super('Too many wrong codes. Try again in 15 minutes.', 429);
  }
}

@Injectable()
export class AdminMfaService {
  constructor(
    private _totp: PrismaRepository<'userTotp'>,
    private _raw: PrismaRepository<'$executeRaw'>,
    private _audit: AuditService
  ) {}

  async status(user: AdminMfaUser) {
    const row = await this._totp.model.userTotp.findUnique({
      where: { userId: user.id },
      select: { enabledAt: true, backupCodes: true },
    });
    return {
      required: isAdministrator(user),
      enabled: !!row?.enabledAt,
      verified: !!user.isSuperAdmin,
      backupCodesLeft: row?.enabledAt ? row.backupCodes.length : 0,
    };
  }

  /**
   * A new secret to scan. Only before the first good code: once the
   * authenticator is on, someone holding the password alone must not be able
   * to swap it for their own. Losing the phone means a backup code, or the
   * row removed by hand by an operator.
   */
  async setup(user: AdminMfaUser) {
    const existing = await this._totp.model.userTotp.findUnique({
      where: { userId: user.id },
      select: { enabledAt: true },
    });
    if (existing?.enabledAt) {
      throw new HttpException('The authenticator is already set up', 409);
    }
    const secret = generateTotpSecret();
    const encrypted = AuthChecker.encryptSecret(secret);
    await this._totp.model.userTotp.upsert({
      where: { userId: user.id },
      create: { userId: user.id, secret: encrypted },
      update: { secret: encrypted, lastStep: null, backupCodes: [] },
    });
    this._audit.record({ action: 'admin.mfa.setup', userId: user.id });

    const uri = otpauthUri(ISSUER, user.email, secret);
    const qr = qrcode(0, 'M');
    qr.addData(uri);
    qr.make();
    return {
      secret,
      uri,
      qrSvg: qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true }),
    };
  }

  /** The first good code turns the authenticator on and hands out the backup codes, once. */
  async enable(user: AdminMfaUser, code: string) {
    await this.assertNotLocked(user.id);
    const row = await this._totp.model.userTotp.findUnique({
      where: { userId: user.id },
    });
    if (!row) {
      throw new HttpException('Scan the QR code first', 400);
    }
    if (row.enabledAt) {
      throw new HttpException('The authenticator is already set up', 409);
    }
    const step = verifyTotp(AuthChecker.decryptSecret(row.secret), code, {
      lastStep: row.lastStep,
    });
    if (step === null) {
      await this.failed(user.id, 'enable');
    }
    const backupCodes = generateBackupCodes();
    const updated = await this._totp.model.userTotp.updateMany({
      where: { userId: user.id, enabledAt: null },
      data: {
        enabledAt: new Date(),
        lastStep: step,
        backupCodes: backupCodes.map((c) =>
          AuthChecker.lookupHash(normalizeBackupCode(c))
        ),
      },
    });
    if (updated.count !== 1) {
      throw new HttpException('The authenticator is already set up', 409);
    }
    await ioRedis.del(adminMfaFailuresKey(user.id));
    this._audit.record({ action: 'admin.mfa.enabled', userId: user.id });
    return { backupCodes };
  }

  /** A code from the app, or one backup code. */
  async verify(user: AdminMfaUser, code: string) {
    await this.assertNotLocked(user.id);
    const row = await this._totp.model.userTotp.findUnique({
      where: { userId: user.id },
    });
    if (!row?.enabledAt) {
      throw new HttpException('Set up the authenticator first', 400);
    }

    const step = verifyTotp(AuthChecker.decryptSecret(row.secret), code, {
      lastStep: row.lastStep,
    });
    if (step !== null) {
      // Conditional on the step, so two requests racing with the same code
      // cannot both pass.
      const claimed = await this._totp.model.userTotp.updateMany({
        where: {
          userId: user.id,
          OR: [{ lastStep: null }, { lastStep: { lt: step } }],
        },
        data: { lastStep: step },
      });
      if (claimed.count === 1) {
        await ioRedis.del(adminMfaFailuresKey(user.id));
        this._audit.record({ action: 'admin.mfa.verified', userId: user.id });
        return { backupCodesLeft: row.backupCodes.length };
      }
    }

    const hash = AuthChecker.lookupHash(normalizeBackupCode(code));
    if (normalizeBackupCode(code).length === 10) {
      // array_remove only when the code is still there: one use, even for
      // two requests at once.
      const removed = await this._raw.model.$executeRaw`
        UPDATE "UserTotp"
           SET "backupCodes" = array_remove("backupCodes", ${hash}),
               "updatedAt" = NOW()
         WHERE "userId" = ${user.id} AND ${hash} = ANY("backupCodes")`;
      if (removed === 1) {
        await ioRedis.del(adminMfaFailuresKey(user.id));
        const left = row.backupCodes.length - 1;
        this._audit.record({
          action: 'admin.mfa.backup-code',
          userId: user.id,
          metadata: { left },
        });
        return { backupCodesLeft: left };
      }
    }

    return this.failed(user.id, 'verify');
  }

  private async assertNotLocked(userId: string) {
    const failures = Number(
      (await ioRedis.get(adminMfaFailuresKey(userId))) || 0
    );
    if (failures >= ADMIN_MFA_MAX_FAILURES) {
      throw new TooManyAttempts();
    }
  }

  private async failed(userId: string, stage: 'enable' | 'verify'): Promise<never> {
    const key = adminMfaFailuresKey(userId);
    const total = await ioRedis.incr(key);
    if (total === 1) {
      await ioRedis.expire(key, ADMIN_MFA_LOCK_SECONDS);
    }
    this._audit.record({
      action: total >= ADMIN_MFA_MAX_FAILURES ? 'admin.mfa.locked' : 'admin.mfa.failed',
      userId,
      metadata: { stage, failures: total },
    });
    if (total >= ADMIN_MFA_MAX_FAILURES) {
      throw new TooManyAttempts();
    }
    throw new HttpException('That code is not right', 400);
  }
}
