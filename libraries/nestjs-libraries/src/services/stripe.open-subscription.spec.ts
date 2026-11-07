const list = jest.fn();

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: { list },
  }));
  mock.errors = actual.errors ?? actual.default?.errors;
  return mock;
});
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

// An administrator's comp is refused only while the organization's Stripe
// customer has a subscription Stripe can still bill or change; the customer
// the plan page creates on first sight has none.
describe('hasOpenSubscription', () => {
  const service = new StripeService({} as any, {} as any, {} as any, {} as any, {} as any);
  const withStatuses = (statuses: string[]) =>
    list.mockResolvedValueOnce({ data: statuses.map((status, i) => ({ id: `sub_${i}`, status })) });

  beforeEach(() => list.mockReset());

  it('asks for every subscription of the customer, on one full page', async () => {
    withStatuses([]);
    await service.hasOpenSubscription('cus_1');
    expect(list).toHaveBeenCalledWith({ customer: 'cus_1', status: 'all', limit: 100 });
  });

  it('is false for a customer that never subscribed', async () => {
    withStatuses([]);
    expect(await service.hasOpenSubscription('cus_1')).toBe(false);
  });

  it('is false when every subscription is over', async () => {
    withStatuses(['canceled', 'incomplete_expired']);
    expect(await service.hasOpenSubscription('cus_1')).toBe(false);
  });

  it.each(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete'])(
    'is true while one is %s',
    async (status) => {
      withStatuses(['canceled', status]);
      expect(await service.hasOpenSubscription('cus_1')).toBe(true);
    }
  );
});
