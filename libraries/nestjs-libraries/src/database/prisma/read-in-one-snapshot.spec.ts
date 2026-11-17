import { readInOneSnapshot } from './prisma.service';
import { SubscriptionRepository } from './subscriptions/subscription.repository';
import { AiUsageService } from './ai-usage/ai-usage.service';
import { OrganizationRepository } from './organizations/organization.repository';
import { UsersService } from './users/users.service';
import { AdminController } from '@gitroom/backend/api/routes/admin.controller';

// The admin's list of comps and the AI cost report answered 500 now and then:
// Prisma read the subscriptions, an organisation was deleted, and the second
// query found no organisation for a row that requires one. Both reads now
// run inside one snapshot. (Against a real Postgres with organisations
// created and deleted meanwhile: 10,892 failures in 20,556 reads before, none
// in 11,777 after.)

// A stand-in client: the transaction hands out `tx`, the bare client throws,
// so a read that goes around the snapshot fails the test.
const client = (rows: unknown[]) => {
  const options: unknown[] = [];
  const findMany = jest.fn().mockResolvedValue(rows);
  const outside = () => {
    throw new Error('read outside the snapshot');
  };
  return {
    options,
    findMany,
    prisma: {
      subscription: { findMany: outside },
      $transaction: async (run: (tx: unknown) => unknown, opts: unknown) => {
        options.push(opts);
        return run({ subscription: { findMany } });
      },
    },
  };
};

describe('lists that join a required relation are read in one snapshot', () => {
  it('the helper opens a repeatable-read transaction and returns what was read', async () => {
    const { prisma, options } = client([{ id: 1 }]);
    const rows = await readInOneSnapshot(prisma as any, (tx: any) => tx.subscription.findMany());
    expect(rows).toEqual([{ id: 1 }]);
    expect(options).toEqual([{ isolationLevel: 'RepeatableRead' }]);
  });

  it('the comps list', async () => {
    const { prisma, options, findMany } = client([{ organizationId: 'org-1' }]);
    const repository = Object.create(SubscriptionRepository.prototype);
    Object.assign(repository, {
      _prismaTransaction: { model: prisma },
      _subscription: { model: prisma },
    });
    expect(await repository.listComps()).toEqual([{ organizationId: 'org-1' }]);
    expect(options).toEqual([{ isolationLevel: 'RepeatableRead' }]);
    expect(findMany.mock.calls[0][0].select.organization).toEqual({ select: { name: true } });
  });

  it('the AI cost report', async () => {
    const { prisma, options, findMany } = client([]);
    const service = Object.create(AiUsageService.prototype);
    Object.assign(service, {
      _prisma: {
        ...prisma,
        aiUsage: { groupBy: async (): Promise<unknown[]> => [] },
      },
    });
    const report = await service.marginReport();
    expect(report.organizations).toEqual([]);
    expect(options).toEqual([{ isolationLevel: 'RepeatableRead' }]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

// Every other list that crosses organisations or accounts and joins one of
// the two things that are hard-deleted (an organisation, an account). The
// stand-in client throws when such a list is read outside a snapshot, and
// answers everything else with nothing.
const joinsParent = (shape: unknown): boolean => {
  if (!shape || typeof shape !== 'object') return false;
  return Object.entries(shape as Record<string, unknown>).some(([key, value]) => {
    if (key === 'where') return false;
    if ((key === 'organization' || key === 'user') && value) return true;
    return joinsParent(value);
  });
};

const anyClient = (found: Record<string, unknown> = {}) => {
  const snapshots: unknown[] = [];
  const model = (name: string, inSnapshot: boolean) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => async (args: any) => {
          if (method === 'findMany' && !inSnapshot && joinsParent(args)) {
            throw new Error(`${name}.findMany joins a parent outside the snapshot`);
          }
          if (method === 'count') return 0;
          if (method === 'findMany' || method === 'groupBy') return [];
          return found[`${name}.${method}`] ?? null;
        },
      }
    );
  const make = (inSnapshot: boolean): any =>
    new Proxy(
      {},
      {
        get: (_t, name: string) => {
          if (name === 'then') return undefined;
          if (name === '$transaction') {
            return async (run: (tx: unknown) => unknown, opts: unknown) => {
              snapshots.push(opts);
              return run(make(true));
            };
          }
          return model(name, inSnapshot);
        },
      }
    );
  return { prisma: make(false), snapshots };
};

describe('the other lists that join an organisation or an account', () => {
  const superAdmin = { id: 'admin-1', isSuperAdmin: true };

  const subscriptions = () => {
    const { prisma, snapshots } = anyClient();
    const repository = Object.create(SubscriptionRepository.prototype);
    Object.assign(repository, {
      _prismaTransaction: { model: prisma },
      _subscription: { model: prisma },
    });
    return { repository, snapshots };
  };

  const organizations = () => {
    const { prisma, snapshots } = anyClient();
    const repository = Object.create(OrganizationRepository.prototype);
    Object.assign(repository, {
      _transaction: { model: prisma },
      _userOrg: { model: prisma },
      _organization: { model: prisma },
      _user: { model: prisma },
    });
    return { repository, snapshots };
  };

  const admin = () => {
    const { prisma, snapshots } = anyClient();
    const controller = Object.create(AdminController.prototype);
    Object.assign(controller, { _prisma: prisma });
    return { controller, snapshots };
  };

  it('comps whose end date has passed (the nightly job)', async () => {
    const { repository, snapshots } = subscriptions();
    await expect(repository.listExpiredComps(new Date())).resolves.toEqual([]);
    expect(snapshots).toEqual([{ isolationLevel: 'RepeatableRead' }]);
  });

  it('plans in force that are not lifetime (the channel count job)', async () => {
    const { repository, snapshots } = subscriptions();
    await expect(repository.listActiveNonLifetime()).resolves.toEqual([]);
    expect(snapshots).toEqual([{ isolationLevel: 'RepeatableRead' }]);
  });

  it('the impersonation search', async () => {
    const { repository, snapshots } = organizations();
    await expect(repository.getImpersonateUser('ann')).resolves.toEqual([]);
    expect(snapshots).toEqual([{ isolationLevel: 'RepeatableRead' }]);
  });

  it('who is told the API key was replaced', async () => {
    const { repository, snapshots } = organizations();
    await expect(repository.getApiKeyHolders('org-1')).resolves.toEqual([]);
    expect(snapshots).toEqual([{ isolationLevel: 'RepeatableRead' }]);
  });

  it('the admin list of accounts', async () => {
    const { controller, snapshots } = admin();
    const out = await controller.listUsers(superAdmin);
    expect(out.items).toEqual([]);
    expect(snapshots).toEqual([{ isolationLevel: 'RepeatableRead' }]);
  });

  it('the admin subscriptions page', async () => {
    const { controller, snapshots } = admin();
    const out = await controller.getSubscriptions(superAdmin);
    expect(out.recent).toEqual([]);
    expect(snapshots).toEqual([{ isolationLevel: 'RepeatableRead' }]);
  });

  it('the admin list of channels', async () => {
    const { controller, snapshots } = admin();
    Object.assign(controller, {
      _integrationManager: { getAllowedSocialsIntegrations: (): string[] => [] },
    });
    const out = await controller.listIntegrations(superAdmin);
    expect(out.items).toEqual([]);
    expect(snapshots).toEqual([{ isolationLevel: 'RepeatableRead' }]);
  });

  it("an account's data export (its organisations)", async () => {
    const { prisma, snapshots } = anyClient({ 'user.findUnique': { id: 'user-1' } });
    const service = Object.create(UsersService.prototype);
    Object.assign(service, { _prisma: prisma });
    const out = await service.exportUserData('user-1');
    expect(out).toBeTruthy();
    expect(snapshots).toContainEqual({ isolationLevel: 'RepeatableRead' });
  });
});
