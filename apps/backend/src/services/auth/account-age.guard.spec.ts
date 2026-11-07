import { HttpException } from '@nestjs/common';
import { AccountAgeGuard } from './account-age.guard';

// The AI cooldown: an hour after signup before the AI tools answer. It is
// there for accounts nobody has paid for yet; an organization on a paid,
// comped or lifetime plan was refused all the same.

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

const run = async (org: any, createdAt: Date) => {
  const users = { getUserById: jest.fn().mockResolvedValue({ id: 'u1', createdAt }) };
  const guard = new AccountAgeGuard(users as any);
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u1' }, org }) }),
  } as any;
  return guard.canActivate(context);
};

describe('AccountAgeGuard', () => {
  const plan = { subscriptionTier: 'PRO', deletedAt: null as Date | null };

  it('holds back a ten-minute-old account on a trial, saying when AI unlocks', async () => {
    await expect(run({ isTrailing: true, subscription: plan }, minutesAgo(10))).rejects.toThrow(
      'AI tools unlock one hour after signup, in 50 minutes. Try our templates in the meantime!'
    );
  });

  it('says "1 minute", not "1 minutes"', async () => {
    await expect(run({ isTrailing: true, subscription: plan }, minutesAgo(59.5))).rejects.toThrow(
      'in 1 minute.'
    );
  });

  it('holds back a ten-minute-old account with no plan', async () => {
    await expect(run({ isTrailing: false, subscription: null }, minutesAgo(10))).rejects.toThrow(
      HttpException
    );
  });

  it('lets a ten-minute-old account on a paid or comped plan through', async () => {
    await expect(run({ isTrailing: false, subscription: plan }, minutesAgo(10))).resolves.toBe(true);
  });

  it('lets a lifetime plan through', async () => {
    await expect(
      run(
        { isTrailing: false, subscription: { subscriptionTier: 'ULTIMATE', isLifetime: true, deletedAt: null } },
        minutesAgo(1)
      )
    ).resolves.toBe(true);
  });

  it('does not count a deleted plan', async () => {
    await expect(
      run({ isTrailing: false, subscription: { ...plan, deletedAt: new Date() } }, minutesAgo(10))
    ).rejects.toThrow(HttpException);
  });

  it('lets any account older than an hour through', async () => {
    await expect(run({ isTrailing: true, subscription: plan }, minutesAgo(61))).resolves.toBe(true);
  });
});
