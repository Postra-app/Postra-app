import { Role } from '@prisma/client';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

// E2E-11-362: a plan downgrade turns off the seats over the new cap. An admin
// whose seat went off could no longer use the organisation, but the API key
// they had seen kept working. The key is replaced with the seat change;
// turning seats back on replaces nothing.
const repoWith = (enabledAdmins: string[]) => {
  const tx = {
    userOrganization: {
      findMany: jest.fn(async ({ where }: any) =>
        enabledAdmins
          .filter((id) => !where.userId || where.userId.in.includes(id))
          .map((userId) => ({ userId }))
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    organization: { update: jest.fn().mockResolvedValue({}) },
  };
  const transaction = { model: { $transaction: jest.fn(async (fn: any) => fn(tx)) } };
  const repo = new OrganizationRepository({} as any, {} as any, {} as any, {} as any, transaction as any);
  return { repo, tx };
};

describe('turning seats off', () => {
  it("replaces the key in the same transaction when an admin's seat goes off", async () => {
    const { repo, tx } = repoWith(['admin-1']);
    await expect(repo.setMembersDisabled('org-1', ['admin-1', 'user-1'], true)).resolves.toEqual({
      count: 1,
      adminsDisabled: ['admin-1'],
    });
    expect(tx.userOrganization.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        userId: { in: ['admin-1', 'user-1'] },
        role: Role.ADMIN,
        disabled: false,
      },
      select: { userId: true },
    });
    expect(tx.organization.update).toHaveBeenCalledTimes(1);
    expect(tx.organization.update.mock.calls[0][0].data.apiKeyHash).toEqual(expect.any(String));
  });

  it('keeps the key when only plain members go off, and when seats come back on', async () => {
    const users = repoWith([]);
    await users.repo.setMembersDisabled('org-1', ['user-1'], true);
    expect(users.tx.organization.update).not.toHaveBeenCalled();

    const back = repoWith(['admin-1']);
    await expect(back.repo.setMembersDisabled('org-1', ['admin-1'], false)).resolves.toEqual({
      count: 1,
      adminsDisabled: [],
    });
    expect(back.tx.organization.update).not.toHaveBeenCalled();
  });

  it('the bulk switch-off replaces it too', async () => {
    const { repo, tx } = repoWith(['admin-1', 'admin-2']);
    await expect(repo.disableOrEnableNonSuperAdminUsers('org-1', true)).resolves.toEqual({
      count: 1,
      adminsDisabled: ['admin-1', 'admin-2'],
    });
    expect(tx.organization.update).toHaveBeenCalledTimes(1);
  });
});

describe('a downgrade over the seat cap', () => {
  const build = (members: { userId: string; role: Role; disabled: boolean }[], adminsDisabled: string[]) => {
    const repo = {
      getMembersForSeatReconcile: jest.fn().mockResolvedValue(
        members.map((m, i) => ({ ...m, createdAt: new Date(2026, 0, i + 1) }))
      ),
      setMembersDisabled: jest.fn(async (_org: string, _ids: string[], disabled: boolean) => ({
        count: 1,
        adminsDisabled: disabled ? adminsDisabled : [],
      })),
    };
    const service = new OrganizationService(repo as any, {} as any);
    const after = jest.spyOn(service, 'afterApiKeyReplaced').mockResolvedValue(undefined);
    return { service, repo, after };
  };

  it('tells the remaining owners and admins, with the reason', async () => {
    const { service, repo, after } = build(
      [
        { userId: 'owner', role: Role.SUPERADMIN, disabled: false },
        { userId: 'admin-1', role: Role.ADMIN, disabled: false },
      ],
      ['admin-1']
    );
    await service.reconcileTeamSeats('org-1', 1);
    expect(repo.setMembersDisabled).toHaveBeenCalledWith('org-1', ['admin-1'], true);
    expect(after).toHaveBeenCalledWith(['org-1'], 'seat-disabled', ['admin-1']);
  });

  it('an upgrade that turns seats back on tells no one', async () => {
    const { service, after } = build(
      [
        { userId: 'owner', role: Role.SUPERADMIN, disabled: false },
        { userId: 'admin-1', role: Role.ADMIN, disabled: true },
      ],
      []
    );
    await service.reconcileTeamSeats('org-1', 5);
    expect(after).not.toHaveBeenCalled();
  });
});
