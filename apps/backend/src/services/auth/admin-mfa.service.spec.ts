process.env.JWT_SECRET = 'test-secret';

import { AdminMfaService } from '@gitroom/backend/services/auth/admin-mfa.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { normalizeBackupCode, totpCode, totpStep } from '@gitroom/helpers/auth/totp';
import { adminMfaFailuresKey } from '@gitroom/backend/services/auth/admin-mfa';

// The second step of an administrator's sign-in: the secret can only be set
// once, a code works once, a backup code works once, and five wrong codes stop
// the step for a quarter of an hour.

type Row = {
  userId: string;
  secret: string;
  enabledAt: Date | null;
  lastStep: number | null;
  backupCodes: string[];
};

const fakeDb = () => {
  const rows = new Map<string, Row>();
  const userTotp = {
    findUnique: jest.fn(async ({ where }: any) => {
      const r = rows.get(where.userId);
      return r ? { ...r, backupCodes: [...r.backupCodes] } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      if (rows.has(data.userId)) throw new Error('Unique constraint failed');
      rows.set(data.userId, { enabledAt: null, lastStep: null, backupCodes: [], ...data });
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const r = rows.get(where.userId);
      if (!r) return { count: 0 };
      if ('enabledAt' in where && r.enabledAt !== where.enabledAt) return { count: 0 };
      if ('secret' in where && r.secret !== where.secret) return { count: 0 };
      if (where.OR && !(r.lastStep === null || r.lastStep < where.OR[1].lastStep.lt)) {
        return { count: 0 };
      }
      Object.assign(r, data);
      return { count: 1 };
    }),
  };
  // array_remove(...) WHERE hash = ANY(...)
  const $executeRaw = jest.fn(async (_sql: TemplateStringsArray, hash: string, userId: string) => {
    const r = rows.get(userId);
    if (!r || !r.backupCodes.includes(hash)) return 0;
    r.backupCodes = r.backupCodes.filter((c) => c !== hash);
    return 1;
  });
  return { rows, userTotp, $executeRaw };
};

const admin = { id: 'admin-1', email: 'admin@postra.co.uk', adminMfaPending: true };

const build = () => {
  const db = fakeDb();
  const audit = { record: jest.fn() };
  const service = new AdminMfaService(
    { model: { userTotp: db.userTotp } } as any,
    { model: { $executeRaw: db.$executeRaw } } as any,
    audit as any
  );
  return { service, db, audit };
};

const enrolled = async () => {
  const ctx = build();
  const { secret } = await ctx.service.setup(admin);
  const step = totpStep() - 1;
  const { backupCodes } = await ctx.service.enable(admin, totpCode(secret, step));
  return { ...ctx, secret, backupCodes, enabledStep: step };
};

beforeEach(async () => {
  await ioRedis.del(adminMfaFailuresKey(admin.id));
});

describe('setting up the authenticator', () => {
  it('stores the secret encrypted and shows a QR code of the otpauth URI', async () => {
    const { service, db, audit } = build();
    const out = await service.setup(admin);
    expect(out.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(out.uri).toContain(`secret=${out.secret}`);
    expect(out.qrSvg.startsWith('<svg')).toBe(true);
    const row = db.rows.get(admin.id)!;
    expect(row.secret).not.toContain(out.secret);
    expect(AuthService.decryptSecret(row.secret)).toBe(out.secret);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.mfa.setup' }));
  });

  it('turns on with the first good code and hands out ten backup codes, stored hashed', async () => {
    const { db, backupCodes } = await enrolled();
    const row = db.rows.get(admin.id)!;
    expect(row.enabledAt).toBeInstanceOf(Date);
    expect(backupCodes).toHaveLength(10);
    expect(row.backupCodes).toHaveLength(10);
    for (const code of backupCodes) {
      expect(row.backupCodes).toContain(AuthService.lookupHash(normalizeBackupCode(code)));
      expect(row.backupCodes).not.toContain(code);
    }
  });

  it('cannot be replaced once on: the password alone must not swap the phone', async () => {
    const { service } = await enrolled();
    await expect(service.setup(admin)).rejects.toMatchObject({ status: 409 });
    await expect(service.enable(admin, '123456')).rejects.toMatchObject({ status: 409 });
  });

  it('a /setup that lands after an /enable cannot replace the authenticator just turned on', async () => {
    const { service, db } = build();
    const { secret } = await service.setup(admin);
    // /setup read "not on" before the /enable below wrote; its write comes last.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    db.userTotp.findUnique.mockImplementationOnce(async () => {
      await gate;
      return null;
    });
    const late = service.setup(admin);
    await service.enable(admin, totpCode(secret, totpStep()));
    const on = { ...db.rows.get(admin.id)! };
    release();
    await expect(late).rejects.toMatchObject({ status: 409 });
    expect(db.rows.get(admin.id)).toEqual(on);
  });

  it('an /enable whose secret was replaced in between does not turn the new one on', async () => {
    const { service, db } = build();
    const first = await service.setup(admin);
    const code = totpCode(first.secret, totpStep());
    // /enable read the first secret; a second /setup replaces it before the write.
    const realFind = db.userTotp.findUnique.getMockImplementation()!;
    db.userTotp.findUnique.mockImplementationOnce(async (args: any) => {
      const row = await realFind(args);
      await service.setup(admin);
      return row;
    });
    await expect(service.enable(admin, code)).rejects.toMatchObject({ status: 409 });
    expect(db.rows.get(admin.id)!.enabledAt).toBeNull();
  });

  it('does not turn on with a wrong code', async () => {
    const { service, db } = build();
    const { secret } = await service.setup(admin);
    const wrong = totpCode(secret, totpStep() + 5);
    await expect(service.enable(admin, wrong)).rejects.toMatchObject({ status: 400 });
    expect(db.rows.get(admin.id)!.enabledAt).toBeNull();
  });
});

describe('the second step at sign-in', () => {
  it('accepts a current code once', async () => {
    const { service, secret } = await enrolled();
    const code = totpCode(secret, totpStep());
    await expect(service.verify(admin, code)).resolves.toEqual({ backupCodesLeft: 10 });
    await expect(service.verify(admin, code)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses the code that turned it on (already used)', async () => {
    const { service, secret, enabledStep } = await enrolled();
    await expect(service.verify(admin, totpCode(secret, enabledStep))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('takes a backup code once, in any case and with or without the dash', async () => {
    const { service, backupCodes, audit } = await enrolled();
    const typed = backupCodes[3].toUpperCase().replace('-', ' ');
    await expect(service.verify(admin, typed)).resolves.toEqual({ backupCodesLeft: 9 });
    await expect(service.verify(admin, backupCodes[3])).rejects.toMatchObject({ status: 400 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.mfa.backup-code', metadata: { left: 9 } })
    );
  });

  it('stops for 15 minutes after five wrong codes, even for the right one', async () => {
    const { service, secret, audit } = await enrolled();
    for (let i = 0; i < 4; i++) {
      await expect(service.verify(admin, '000000')).rejects.toMatchObject({ status: 400 });
    }
    await expect(service.verify(admin, '000000')).rejects.toMatchObject({ status: 429 });
    await expect(service.verify(admin, totpCode(secret, totpStep()))).rejects.toMatchObject({
      status: 429,
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.mfa.locked' }));
    expect(await ioRedis.ttl(adminMfaFailuresKey(admin.id))).toBeGreaterThan(0);
  });

  it('is refused before the authenticator is set up', async () => {
    const { service } = build();
    await expect(service.verify(admin, '123456')).rejects.toMatchObject({ status: 400 });
  });

  it('reports the state the page needs', async () => {
    const { service } = await enrolled();
    await expect(service.status(admin)).resolves.toEqual({
      required: true,
      enabled: true,
      verified: false,
      backupCodesLeft: 10,
    });
    await expect(
      service.status({ id: 'm', email: 'm@example.com', isSuperAdmin: false })
    ).resolves.toMatchObject({ required: false, enabled: false });
  });
});
