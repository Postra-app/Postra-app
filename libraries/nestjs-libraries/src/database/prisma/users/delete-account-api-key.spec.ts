jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({ removeFile: jest.fn() }) },
}));

import {
  AccountChangedError,
  UsersService,
} from '@gitroom/nestjs-libraries/database/prisma/users/users.service';

// An owner or admin of a team that stays deleted their account,
// and the API key they had copied kept working for the team's organisation.
// It is replaced in the deletion's transaction; organisations deleted with
// the account need nothing.
const build = (sole: string[], seen: string[]) => {
  const tx = {
    organization: { delete: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    user: { delete: jest.fn().mockResolvedValue({}) },
    userOrganization: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn(async ({ where }: any) =>
        where.role?.in
          ? seen.map((organizationId) => ({ organizationId }))
          : []
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    userOrganization: {
      findMany: jest.fn().mockResolvedValue(sole.map((organizationId) => ({ organizationId }))),
      count: jest.fn().mockResolvedValue(1),
    },
    media: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    integration: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    brandKit: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    post: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const orgs = { afterApiKeyReplaced: jest.fn().mockResolvedValue(undefined) };
  const service = new UsersService({} as any, {} as any, prisma as any, undefined, orgs as any);
  jest.spyOn(service, 'getSoleOwnedOrganizations').mockResolvedValue(sole);
  return { service, tx, orgs };
};

describe('an owner or admin deletes their account', () => {
  it('replaces the key of a team that stays, not of one deleted with them', async () => {
    const { service, tx, orgs } = build(['own-org'], ['own-org', 'team-org']);
    await service.deleteAccount('u1');
    expect(tx.organization.delete).toHaveBeenCalledWith({ where: { id: 'own-org' } });
    expect(tx.organization.update.mock.calls.map(([a]: any) => a.where.id)).toEqual(['team-org']);
    expect(tx.organization.update.mock.calls[0][0].data.apiKeyHash).toEqual(expect.any(String));
    // Before the user row goes: one transaction.
    expect(tx.organization.update.mock.invocationCallOrder[0]).toBeLessThan(
      tx.user.delete.mock.invocationCallOrder[0]
    );
    expect(orgs.afterApiKeyReplaced).toHaveBeenCalledWith(['team-org'], 'admin-left', 'u1');
  });

  it('a plain member leaves the key alone', async () => {
    const { service, tx, orgs } = build([], []);
    await service.deleteAccount('u1');
    expect(tx.organization.update).not.toHaveBeenCalled();
    expect(orgs.afterApiKeyReplaced).not.toHaveBeenCalled();
  });
});

describe('the deletion checks the session version under the user row lock', () => {
  it('a version that moved meanwhile deletes nothing', async () => {
    const { service, tx } = build(['own-org'], ['own-org']);
    tx.$queryRaw.mockResolvedValueOnce([{ tokenVersion: 4 }]);
    await expect(service.deleteAccount('u1', 3)).rejects.toBeInstanceOf(AccountChangedError);
    expect(tx.organization.delete).not.toHaveBeenCalled();
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it('the same version deletes, and the lock is taken first', async () => {
    const { service, tx } = build(['own-org'], []);
    tx.$queryRaw.mockResolvedValueOnce([{ tokenVersion: 3 }]);
    await service.deleteAccount('u1', 3);
    expect(String(tx.$queryRaw.mock.calls[0][0].join('?'))).toContain('FOR UPDATE');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.organization.delete.mock.invocationCallOrder[0]
    );
    expect(tx.user.delete).toHaveBeenCalled();
  });
});

