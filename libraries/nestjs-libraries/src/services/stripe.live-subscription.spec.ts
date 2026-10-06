const cancel = jest.fn().mockResolvedValue({});

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: { cancel },
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

import {
  StripeService,
  isLiveSubscription,
} from '@gitroom/nestjs-libraries/services/stripe.service';

// Upstream ac65e200: an `incomplete` subscription listed first was cancelled
// instead of the live one — the organisation dropped to FREE while the real
// subscription kept charging.
describe('cancelling picks the live subscription', () => {
  beforeEach(() => jest.clearAllMocks());

  it('incomplete and expired subscriptions are not live', () => {
    expect(
      ['active', 'trialing', 'past_due', 'incomplete', 'incomplete_expired', 'canceled'].filter(
        (status) => isLiveSubscription({ status })
      )
    ).toEqual(['active', 'trialing', 'past_due']);
  });

  it('the admin cancel cancels the active subscription, not an incomplete one before it', async () => {
    const deleteSubscription = jest.fn().mockResolvedValue(undefined);
    const service = new StripeService(
      { deleteSubscription } as any,
      { getOrgById: jest.fn().mockResolvedValue({ id: 'org-1', paymentId: 'cus_1' }) } as any,
      {} as any,
      {} as any,
      {} as any
    );
    jest.spyOn(service as any, 'listSubscriptions').mockResolvedValue([
      { id: 'sub_dead', status: 'incomplete' },
      { id: 'sub_live', status: 'active' },
      // A duplicate from two checkouts at once kept charging when only the
      // first was cancelled (upstream 28e71678).
      { id: 'sub_twin', status: 'active' },
    ]);

    await service.cancelSubscription('org-1');

    expect(cancel.mock.calls.map(([id]) => id)).toEqual(['sub_live', 'sub_twin']);
  });
});
