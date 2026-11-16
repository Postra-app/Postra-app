// Importing the controller drags the integration manager in with it, and that
// pulls `nostr-tools`, which ships ESM that jest will not parse.
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

import { AdminController } from '@gitroom/backend/api/routes/admin.controller';

// E2E-11-362: a suspension ended every session, but the organisation's API
// key the person had seen as an owner or admin kept the public API and MCP
// open to them. Every key they could see is replaced with the suspension.
const admin = { id: 'admin-1', isSuperAdmin: true } as any;

const build = (target: { suspendedAt: Date | null }, adminOf: string[]) => {
  const tx = {
    user: { update: jest.fn().mockResolvedValue({}) },
    userOrganization: {
      findMany: jest.fn().mockResolvedValue(adminOf.map((organizationId) => ({ organizationId }))),
    },
    organization: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'u1@example.com',
        isSuperAdmin: false,
        ...target,
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const orgs = { afterApiKeyReplaced: jest.fn().mockResolvedValue(undefined) };
  const controller = new AdminController(
    {} as any,
    {} as any,
    prisma as any,
    {} as any,
    { record: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    orgs as any
  );
  return { controller, tx, orgs };
};

describe('suspending an account', () => {
  it('replaces the API key of every organisation where they could see it', async () => {
    const { controller, tx, orgs } = build({ suspendedAt: null }, ['org-1', 'org-2']);
    await controller.suspendUser(admin, 'u1', true, 'spam');
    expect(tx.userOrganization.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', role: { in: ['SUPERADMIN', 'ADMIN'] } },
      select: { organizationId: true },
    });
    expect(tx.organization.update.mock.calls.map(([a]: any) => a.where.id)).toEqual([
      'org-1',
      'org-2',
    ]);
    expect(tx.organization.update.mock.calls[0][0].data.apiKeyHash).toEqual(expect.any(String));
    expect(orgs.afterApiKeyReplaced).toHaveBeenCalledWith(['org-1', 'org-2'], 'admin-suspended', 'u1');
  });

  it('a plain member of every organisation leaves the keys alone', async () => {
    const { controller, tx, orgs } = build({ suspendedAt: null }, []);
    await controller.suspendUser(admin, 'u1', true);
    expect(tx.organization.update).not.toHaveBeenCalled();
    expect(orgs.afterApiKeyReplaced).not.toHaveBeenCalled();
  });

  it('lifting a suspension replaces nothing', async () => {
    const { controller, tx, orgs } = build({ suspendedAt: new Date() }, ['org-1']);
    await controller.suspendUser(admin, 'u1', false);
    expect(tx.user.update).toHaveBeenCalled();
    expect(tx.organization.update).not.toHaveBeenCalled();
    expect(orgs.afterApiKeyReplaced).not.toHaveBeenCalled();
  });
});
