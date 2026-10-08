jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));
// The in-memory Redis, not whatever REDIS_URL the shell has.
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => {
  delete process.env.REDIS_URL;
  return jest.requireActual('@gitroom/nestjs-libraries/redis/redis.service');
});
// The services below are only ever injected here, but importing them for real
// drags in integration.manager → nostr-tools, which is ESM and stops jest dead.
// Stubbing the modules keeps this a unit test of StripeService.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({
  UsersService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({
  TrackService: class {},
}));

import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

// BILL-10: two different lifetime codes redeemed at once both read N channels
// and both wrote N + 5 — both codes spent, five channels lost.
it('two lifetime codes redeemed at once never both write from the same count', async () => {
  let subscription = { isLifetime: true, subscriptionTier: 'PRO', totalChannels: 10 };
  const used = new Set<string>();
  const subscriptionService = {
    getSubscriptionByOrganizationId: jest.fn(async () => ({ ...subscription })),
    getCode: jest.fn(async (c: string) => used.has(c)),
    createOrUpdateSubscription: jest.fn(async (_a: any, _b: any, _org: any, channels: number, _t: any, _p: any, _x: any, code: string) => {
      await new Promise((r) => setTimeout(r, 20));
      used.add(code);
      subscription = { ...subscription, totalChannels: channels };
    }),
  };
  const service = new StripeService(subscriptionService as any, {} as any, {} as any, {} as any, {} as any);
  jest.spyOn(AuthService, 'fixedDecryption').mockImplementation((v: string) => v);

  const results = await Promise.all([
    service.lifetimeDeal('org-1', 'code-a'),
    service.lifetimeDeal('org-1', 'code-b'),
  ]);
  const succeeded = results.filter((r) => r.success).length;

  // Whatever went through added 5 channels each; a refused code stays unused.
  expect(subscription.totalChannels).toBe(10 + 5 * succeeded);
  expect(used.size).toBe(succeeded);
});

// E2E-07-36: a code redeemed on a lifetime Business organisation (granted by
// an admin) set it to Pro with Pro's channels. A code never lowers the plan.
it.each([
  ['ULTIMATE', 1000, 'ULTIMATE', 1005],
  ['PRO', 10, 'PRO', 15],
  ['STANDARD', 3, 'PRO', 6],
  [null, 0, 'STANDARD', 3],
] as const)('a code on lifetime %s (%s channels) gives %s with %s channels', async (tier, channels, expectedTier, expectedChannels) => {
  const subscriptionService = {
    getSubscriptionByOrganizationId: jest.fn(async () =>
      tier ? { isLifetime: true, subscriptionTier: tier, totalChannels: channels } : null
    ),
    getCode: jest.fn(async () => false),
    createOrUpdateSubscription: jest.fn(async () => undefined),
  };
  const service = new StripeService(subscriptionService as any, {} as any, {} as any, {} as any, {} as any);
  jest.spyOn(AuthService, 'fixedDecryption').mockImplementation((v: string) => v);

  expect(await service.lifetimeDeal('org-1', `code-${tier}`)).toEqual({ success: true });
  const [, , , totalChannels, subscriptionTier] = subscriptionService.createOrUpdateSubscription.mock.calls[0] as any[];
  expect(subscriptionTier).toBe(expectedTier);
  expect(totalChannels).toBe(expectedChannels);
});
