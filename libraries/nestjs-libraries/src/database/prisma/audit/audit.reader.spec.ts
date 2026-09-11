import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';

/**
 * The writer was corrected in #227 and then nothing read it, so "who put this
 * account on Business, and when" still meant a psql session (E2E-09-34).
 *
 * What matters here is that the reader resolves people to email addresses: an
 * audit row full of uuids answers the question no better than the table did.
 */
const buildPrisma = (rows: any[], users: any[] = [], orgs: any[] = []) => ({
  model: {
    auditLog: {
      findMany: jest.fn(async () => rows),
      count: jest.fn(async () => rows.length),
      groupBy: jest.fn(async () => [
        { action: 'admin.grant-admin', _count: { _all: 1 } },
        { action: 'admin.impersonate', _count: { _all: 2 } },
      ]),
      create: jest.fn(),
    },
    user: { findMany: jest.fn(async () => users) },
    organization: { findMany: jest.fn(async () => orgs) },
  },
});

const page = { skip: 0, limit: 25 };

describe('AuditService.list', () => {
  it('names the actor by email rather than by id', async () => {
    const prisma = buildPrisma(
      [
        {
          id: 'a1',
          action: 'admin.grant-admin',
          userId: 'admin-1',
          organizationId: null,
          ip: '1.2.3.4',
          userAgent: 'Chrome',
          metadata: { targetUserId: 'user-9' },
          createdAt: new Date('2026-09-11T10:00:00Z'),
        },
      ],
      [
        { id: 'admin-1', email: 'admin@postra.pl', name: 'Admin' },
        { id: 'user-9', email: 'client@example.com', name: null },
      ]
    );
    const service = new AuditService(prisma as any);

    const result = await service.list(page);

    expect(result.total).toBe(1);
    expect(result.items[0].actor).toEqual({
      id: 'admin-1',
      email: 'admin@postra.pl',
      name: 'Admin',
    });
    expect(result.items[0].target).toEqual({
      id: 'user-9',
      email: 'client@example.com',
    });
  });

  it('looks every person up in one query, not one per row', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `a${i}`,
      action: 'auth.login',
      userId: 'admin-1',
      organizationId: null,
      ip: null,
      userAgent: null,
      metadata: null,
      createdAt: new Date(),
    }));
    const prisma = buildPrisma(rows, [
      { id: 'admin-1', email: 'admin@postra.pl', name: null },
    ]);
    const service = new AuditService(prisma as any);

    await service.list(page);

    expect(prisma.model.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('reads the impersonation target out of metadata', async () => {
    const prisma = buildPrisma(
      [
        {
          id: 'a1',
          action: 'admin.impersonate',
          userId: 'admin-1',
          organizationId: 'org-1',
          ip: '9.9.9.9',
          userAgent: 'Safari',
          metadata: { impersonatedUserId: 'victim-1' },
          createdAt: new Date(),
        },
      ],
      [
        { id: 'admin-1', email: 'admin@postra.pl', name: null },
        { id: 'victim-1', email: 'someone@example.com', name: null },
      ],
      [{ id: 'org-1', name: 'Acme' }]
    );
    const service = new AuditService(prisma as any);

    const result = await service.list(page);

    expect(result.items[0].target?.email).toBe('someone@example.com');
    expect(result.items[0].organization).toEqual({ id: 'org-1', name: 'Acme' });
  });

  it('falls back to the email recorded in metadata when the account is gone', async () => {
    // admin.delete-user records the address before the delete, because
    // afterwards the id resolves to nobody.
    const prisma = buildPrisma(
      [
        {
          id: 'a1',
          action: 'admin.delete-user',
          userId: 'admin-1',
          organizationId: null,
          ip: null,
          userAgent: null,
          metadata: { targetUserId: 'erased-1', email: 'erased@example.com' },
          createdAt: new Date(),
        },
      ],
      [{ id: 'admin-1', email: 'admin@postra.pl', name: null }]
    );
    const service = new AuditService(prisma as any);

    const result = await service.list(page);

    expect(result.items[0].target).toEqual({
      id: 'erased-1',
      email: 'erased@example.com',
    });
  });

  it('filters by action, user, organization and date', async () => {
    const prisma = buildPrisma([]);
    const service = new AuditService(prisma as any);
    const from = new Date('2026-09-01T00:00:00Z');
    const to = new Date('2026-09-11T23:59:59Z');

    await service.list({
      ...page,
      action: 'billing.refund',
      userId: 'admin-1',
      organizationId: 'org-1',
      from,
      to,
    });

    expect(prisma.model.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          action: 'billing.refund',
          userId: 'admin-1',
          organizationId: 'org-1',
          createdAt: { gte: from, lte: to },
        },
      })
    );
  });

  it('does not look anybody up for an empty page', async () => {
    const prisma = buildPrisma([]);
    const service = new AuditService(prisma as any);

    const result = await service.list(page);

    expect(result.items).toEqual([]);
    expect(prisma.model.user.findMany).not.toHaveBeenCalled();
    expect(prisma.model.organization.findMany).not.toHaveBeenCalled();
  });

  it('offers only the actions that have actually happened', async () => {
    const prisma = buildPrisma([]);
    const service = new AuditService(prisma as any);

    await expect(service.listActions()).resolves.toEqual([
      'admin.grant-admin',
      'admin.impersonate',
    ]);
  });
});
