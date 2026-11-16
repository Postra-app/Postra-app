import { Role } from '@prisma/client';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';

// Owners and admins see the organisation's API key. Removing one,
// or making them a plain member, left the key they had copied working, so the
// public API and MCP stayed open to someone who no longer belonged. The key is
// now replaced in the same transaction as the change.

type Membership = { role: Role; disabled: boolean; user: { suspendedAt: Date | null } };

const repoWith = (memberships: Record<string, Membership | null>) => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    userOrganization: {
      findUnique: jest.fn(async ({ where }: any) =>
        memberships[where.userId_organizationId.userId] ?? null
      ),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(2),
    },
    oAuthAuthorization: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    organization: { update: jest.fn().mockResolvedValue({ id: 'org-1' }) },
  };
  const transaction = { model: { $transaction: jest.fn(async (fn: any) => fn(tx)) } };
  const repo = new OrganizationRepository(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    transaction as any
  );
  return { repo, tx };
};

const member = (role: Role): Membership => ({
  role,
  disabled: false,
  user: { suspendedAt: null },
});

const keyWrites = (tx: ReturnType<typeof repoWith>['tx']) =>
  tx.organization.update.mock.calls.map(([args]: any) => args);

describe('the API key goes with an owner or admin who loses access', () => {
  it('removing an admin replaces the key in the same transaction', async () => {
    const { repo, tx } = repoWith({ owner: member(Role.SUPERADMIN), admin: member(Role.ADMIN) });
    await expect(repo.removeMember('org-1', 'owner', 'admin')).resolves.toEqual({
      ok: true,
      keyReplaced: true,
    });
    const [write] = keyWrites(tx);
    expect(write.where).toEqual({ id: 'org-1' });
    expect(write.data.apiKey).toEqual(expect.any(String));
    expect(write.data.apiKeyHash).toEqual(expect.any(String));
  });

  it('removing a second owner replaces it too', async () => {
    const { repo, tx } = repoWith({ owner: member(Role.SUPERADMIN), other: member(Role.SUPERADMIN) });
    await expect(repo.removeMember('org-1', 'owner', 'other')).resolves.toEqual({
      ok: true,
      keyReplaced: true,
    });
    expect(keyWrites(tx)).toHaveLength(1);
  });

  it('removing a plain member keeps the key: they never saw it', async () => {
    const { repo, tx } = repoWith({ owner: member(Role.SUPERADMIN), user: member(Role.USER) });
    await expect(repo.removeMember('org-1', 'owner', 'user')).resolves.toEqual({
      ok: true,
      keyReplaced: false,
    });
    expect(keyWrites(tx)).toHaveLength(0);
  });

  it('a refused removal changes nothing', async () => {
    const { repo, tx } = repoWith({ admin: member(Role.ADMIN), owner: member(Role.SUPERADMIN) });
    await expect(repo.removeMember('org-1', 'admin', 'owner')).resolves.toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(keyWrites(tx)).toHaveLength(0);
  });

  it('making an admin a member replaces the key and revokes the apps they approved', async () => {
    const { repo, tx } = repoWith({ owner: member(Role.SUPERADMIN), admin: member(Role.ADMIN) });
    await expect(repo.changeMemberRole('org-1', 'owner', 'admin', 'USER')).resolves.toEqual({
      ok: true,
      from: Role.ADMIN,
      keyReplaced: true,
    });
    expect(keyWrites(tx)).toHaveLength(1);
    expect(tx.oAuthAuthorization.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', userId: 'admin', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('making a member an admin, or handing ownership over, keeps the key', async () => {
    const up = repoWith({ owner: member(Role.SUPERADMIN), user: member(Role.USER) });
    await expect(up.repo.changeMemberRole('org-1', 'owner', 'user', 'ADMIN')).resolves.toEqual({
      ok: true,
      from: Role.USER,
      keyReplaced: false,
    });
    expect(keyWrites(up.tx)).toHaveLength(0);

    // The old owner stays on as an admin: they still see the key.
    const hand = repoWith({ owner: member(Role.SUPERADMIN), admin: member(Role.ADMIN) });
    await expect(hand.repo.changeMemberRole('org-1', 'owner', 'admin', 'OWNER')).resolves.toEqual({
      ok: true,
      from: Role.ADMIN,
      keyReplaced: false,
    });
    expect(keyWrites(hand.tx)).toHaveLength(0);
  });
});
