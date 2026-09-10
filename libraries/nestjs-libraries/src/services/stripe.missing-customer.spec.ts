const listSubscriptions = jest.fn();
const listCharges = jest.fn();
const retrieveCustomer = jest.fn();
const createCustomer = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    subscriptions: { list: listSubscriptions },
    charges: { list: listCharges },
    customers: { retrieve: retrieveCustomer, create: createCustomer },
  }))
);

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

const noSuchCustomer = Object.assign(new Error("No such customer: 'cus_dead'"), {
  type: 'invalid_request_error',
  code: 'resource_missing',
  param: 'customer',
});

const org = (paymentId: string | null) => ({ id: 'org-1', paymentId, name: 'Acme' });

const build = (paymentId: string | null) => {
  const subscriptionService = {
    checkSubscription: jest.fn().mockResolvedValue(null),
    updateCustomerId: jest.fn().mockResolvedValue(undefined),
  };
  const organizationService = {
    getOrgById: jest.fn().mockResolvedValue(org(paymentId)),
    getTeam: jest
      .fn()
      .mockResolvedValue({ users: [{ user: { email: 'owner@postra.co.uk' } }] }),
  };
  const service = new StripeService(
    subscriptionService as any,
    organizationService as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { service, subscriptionService, organizationService };
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRIPE_DISCOUNT_ID = 'di_test';
});

describe('a Stripe customer we stored and Stripe no longer has', () => {
  it('reads as "no subscription" instead of throwing (GET /billing/check/:id)', async () => {
    listSubscriptions.mockRejectedValueOnce(noSuchCustomer);
    const { service } = build('cus_dead');

    await expect(service.checkSubscription('org-1', 'uniq-1')).resolves.toBe(0);
  });

  it('never asks Stripe for the whole account when the org has no customer', async () => {
    const { service } = build(null);

    await expect(service.getCustomerSubscriptions('org-1')).resolves.toEqual({
      data: [],
    });
    expect(listSubscriptions).not.toHaveBeenCalled();
  });

  it('still throws on a Stripe failure that is not a missing customer', async () => {
    listSubscriptions.mockRejectedValueOnce(
      Object.assign(new Error('rate limited'), {
        type: 'rate_limit_error',
        code: 'rate_limit',
      })
    );
    const { service } = build('cus_live');

    await expect(service.getCustomerSubscriptions('org-1')).rejects.toThrow(
      'rate limited'
    );
  });

  it('does not block deleting an account whose customer is gone', async () => {
    listSubscriptions.mockRejectedValueOnce(noSuchCustomer);
    const { service } = build('cus_dead');

    await expect(
      service.cancelAllSubscriptionsForDeletedAccount('org-1')
    ).resolves.toBeUndefined();
  });

  it('says "no active subscription" instead of crashing when cancelling', async () => {
    listSubscriptions.mockRejectedValueOnce(noSuchCustomer);
    const { service } = build('cus_dead');

    await expect(service.cancelSubscription('org-1')).rejects.toThrow(
      'No active subscription found'
    );
  });

  it('shows an empty billing history rather than breaking the page', async () => {
    listCharges.mockRejectedValueOnce(noSuchCustomer);
    const { service } = build('cus_dead');

    await expect(service.getCharges('org-1')).resolves.toEqual([]);
  });

  it('lets the billing page open instead of 500-ing on the discount check', async () => {
    listCharges.mockRejectedValueOnce(noSuchCustomer);
    const { service } = build('cus_dead');

    await expect(service.checkDiscount('cus_dead')).resolves.toBe(false);
  });

  it('creates a fresh customer at checkout rather than reusing the dead id', async () => {
    retrieveCustomer.mockRejectedValueOnce(noSuchCustomer);
    createCustomer.mockResolvedValueOnce({ id: 'cus_new' });
    const { service, subscriptionService } = build('cus_dead');

    await expect(
      service.createOrGetCustomer(org('cus_dead') as any)
    ).resolves.toBe('cus_new');
    expect(subscriptionService.updateCustomerId).toHaveBeenCalledWith(
      'org-1',
      'cus_new'
    );
  });

  it('keeps the stored customer when Stripe still has it', async () => {
    retrieveCustomer.mockResolvedValueOnce({ id: 'cus_live', deleted: false });
    const { service } = build('cus_live');

    await expect(
      service.createOrGetCustomer(org('cus_live') as any)
    ).resolves.toBe('cus_live');
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('does not create a duplicate customer when Stripe merely hiccups', async () => {
    retrieveCustomer.mockRejectedValueOnce(
      Object.assign(new Error('connection error'), { type: 'api_connection_error' })
    );
    const { service } = build('cus_live');

    await expect(
      service.createOrGetCustomer(org('cus_live') as any)
    ).rejects.toThrow('connection error');
    expect(createCustomer).not.toHaveBeenCalled();
  });
});
