jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), set: jest.fn() },
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/maintenance/maintenance.service', () => ({
  MaintenanceService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({
  SubscriptionService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/services/apple/apple.iap.service', () => ({
  AppleIapService: class {},
}));

import { HousekeepingActivity } from './housekeeping.activity';

// App Store plans whose expiry notification never came are ended by the
// daily run (AppleIapService.expireLapsed); the activity only reports it.
const activity = (ended: string[]) =>
  new HousekeepingActivity(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { expireLapsed: jest.fn().mockResolvedValue(ended) } as any
  );

it('reports how many lapsed App Store plans went back to Free', async () => {
  await expect(activity(['o1', 'o2']).expireAppleSubscriptions()).resolves.toEqual({ ended: 2 });
  await expect(activity([]).expireAppleSubscriptions()).resolves.toEqual({ ended: 0 });
});
