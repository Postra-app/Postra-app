jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), set: jest.fn() },
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/maintenance/maintenance.service', () => ({
  MaintenanceService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({
  SubscriptionService: class {},
}));

import { HousekeepingActivity } from './housekeeping.activity';

// Comps given for a time come back on their end date; the administrators
// learn which ones from one mail, and nobody is mailed on a day with none.
const row = {
  organizationId: 'o1',
  subscriptionTier: 'PRO',
  compReason: 'influencer',
  compEndsAt: new Date('2026-11-09T10:00:00Z'),
  organization: { name: 'Creator <Studio>' },
};

const activity = (expired: unknown[], send: jest.Mock) =>
  new HousekeepingActivity(
    {} as any,
    {} as any,
    { sendEmailSync: send } as any,
    { user: { findMany: async () => [{ email: 'admin@example.com' }] } } as any,
    { expireComps: async () => expired } as any
  );

it('mails the administrators the comps that ended, with names escaped', async () => {
  const send = jest.fn().mockResolvedValue(true);
  await expect(activity([row], send).expireComps()).resolves.toEqual({ expired: 1 });
  expect(send).toHaveBeenCalledTimes(1);
  const [to, subject, html] = send.mock.calls[0];
  expect(to).toBe('admin@example.com');
  expect(subject).toBe('Postra: 1 comp ended, back on Free');
  expect(html).toContain('Creator &lt;Studio&gt;');
  expect(html).toContain('influencer');
  expect(html).toContain('2026-11-09');
});

it('sends nothing on a day without an ended comp', async () => {
  const send = jest.fn();
  await expect(activity([], send).expireComps()).resolves.toEqual({ expired: 0 });
  expect(send).not.toHaveBeenCalled();
});
