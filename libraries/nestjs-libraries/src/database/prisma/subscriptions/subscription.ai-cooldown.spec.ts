jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/redis/auth-context.cache', () => ({ bustAuthContextCacheForUsers: jest.fn() }));

import { HttpException } from '@nestjs/common';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';

// The hour after signup held only on the Studio and composer buttons: a fresh
// trial asked the assistant, the public API or MCP for an image or a clip and
// got it. Every paid image and clip is spent through useCredit.
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const plan = { subscriptionTier: 'PRO', deletedAt: null as Date | null };

const spend = (org: any, getOrgById = async () => org) => {
  const useCredit = jest.fn(async (_o: unknown, _t: string, fn: (r: { id: string }) => Promise<unknown>) =>
    fn({ id: 'c1' })
  );
  const service = new SubscriptionService(
    { useCredit, getSubscriptionByOrgId: async () => org.subscription } as any,
    {} as any,
    { getOrgById } as any,
    {} as any,
    {} as any
  );
  return { useCredit, service };
};

describe('the AI hour after signup, wherever the AI is asked for', () => {
  it('refuses a ten-minute-old trial with 403 and spends nothing', async () => {
    const { service, useCredit } = spend({ id: 'o', isTrailing: true, subscription: plan, createdAt: minutesAgo(10) });
    const run = jest.fn();
    const err = await service.useCredit({ id: 'o', isTrailing: true, subscription: plan, createdAt: minutesAgo(10) } as any, 'ai_videos', run).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(403);
    expect(err.message).toBe('AI tools unlock one hour after signup, in 50 minutes. Try our templates in the meantime!');
    expect(useCredit).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('holds a fresh organisation the same when it is read by id (background paths)', async () => {
    const org = { id: 'o', isTrailing: true, subscription: plan, createdAt: minutesAgo(5) };
    const { service, useCredit } = spend(org);
    await expect(service.useCreditByOrgId('o', 'ai_images', async () => 'x')).rejects.toThrow('one hour after signup');
    expect(useCredit).not.toHaveBeenCalled();
  });

  it('a cooldown read from the auth cache (a date as text) counts too', async () => {
    const { service } = spend({});
    await expect(
      service.useCredit({ id: 'o', isTrailing: true, subscription: plan, createdAt: minutesAgo(30).toISOString() } as any, 'ai_images', async () => 'x')
    ).rejects.toThrow('in 30 minutes');
  });

  it('lets a trial older than an hour through', async () => {
    const { service, useCredit } = spend({});
    await expect(
      service.useCredit({ id: 'o', isTrailing: true, subscription: plan, createdAt: minutesAgo(61) } as any, 'ai_images', async () => 'ok')
    ).resolves.toBe('ok');
    expect(useCredit).toHaveBeenCalledTimes(1);
  });

  it('lets a fresh organisation on a paid, comped or lifetime plan through', async () => {
    const { service } = spend({});
    await expect(
      service.useCredit({ id: 'o', isTrailing: false, subscription: plan, createdAt: minutesAgo(1) } as any, 'ai_images', async () => 'ok')
    ).resolves.toBe('ok');
  });

  it('does not count a deleted plan as paid', async () => {
    const { service } = spend({});
    await expect(
      service.useCredit({ id: 'o', isTrailing: false, subscription: { ...plan, deletedAt: new Date() }, createdAt: minutesAgo(1) } as any, 'ai_images', async () => 'ok')
    ).rejects.toThrow(HttpException);
  });
});
