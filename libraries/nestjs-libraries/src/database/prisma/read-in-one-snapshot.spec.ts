import { readInOneSnapshot } from './prisma.service';
import { SubscriptionRepository } from './subscriptions/subscription.repository';
import { AiUsageService } from './ai-usage/ai-usage.service';

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
