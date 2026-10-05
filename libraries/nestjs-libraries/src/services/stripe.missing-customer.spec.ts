const listSubscriptions = jest.fn();
const listCharges = jest.fn();
const retrieveCustomer = jest.fn();
const createCustomer = jest.fn();
const deleteCustomer = jest.fn().mockResolvedValue({ deleted: true });
const updateCustomer = jest.fn().mockResolvedValue({});

jest.mock('stripe', () => {
  // Keep the real `errors` namespace on the mock: the rejections below have to
  // be built by the SDK, or they carry a shape production never produces
  // (E2E-07-02).
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: { list: listSubscriptions },
    charges: { list: listCharges },
    customers: {
      retrieve: retrieveCustomer,
      create: createCustomer,
      update: updateCustomer,
      del: deleteCustomer,
    },
  }));
  mock.errors = actual.errors ?? actual.default?.errors;
  return mock;
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const noSuchCustomer = (require('stripe') as any).errors.StripeError.generate({
  type: 'invalid_request_error',
  code: 'resource_missing',
  param: 'customer',
  message: "No such customer: 'cus_dead'",
  statusCode: 400,
});

const org = (paymentId: string | null) => ({ id: 'org-1', paymentId, name: 'Acme' });

const build = (paymentId: string | null) => {
  const subscriptionService = {
    checkSubscription: jest.fn().mockResolvedValue(null),
    updateCustomerId: jest.fn().mockResolvedValue(undefined),
    assignCustomerId: jest.fn().mockResolvedValue(true),
    getPaymentId: jest.fn().mockResolvedValue(null),
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
    expect(subscriptionService.assignCustomerId).toHaveBeenCalledWith(
      'org-1',
      'cus_dead',
      'cus_new'
    );
    // Keyed on the dead id, so Stripe makes a new customer rather than
    // replaying an earlier answer.
    expect(createCustomer.mock.calls[0][1]).toEqual({
      idempotencyKey: 'customer-org-1-cus_dead',
    });
  });

  it('keeps the stored customer when Stripe still has it', async () => {
    retrieveCustomer.mockResolvedValueOnce({ id: 'cus_live', deleted: false });
    const { service } = build('cus_live');

    await expect(
      service.createOrGetCustomer(org('cus_live') as any)
    ).resolves.toBe('cus_live');
    expect(createCustomer).not.toHaveBeenCalled();
    // D20: an older customer gets the trading-name footer on checkout.
    expect(updateCustomer).toHaveBeenCalledWith('cus_live', {
      invoice_settings: { footer: 'B K Company trading as Postra' },
    });
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

describe('two first checkouts of one organisation at once (E2E-07-12)', () => {
  // A plan switched while the first checkout loads, or two tabs: each
  // created a customer and the last write won, so the other customer could
  // still pay and its webhook found no organisation.
  const race = () => {
    const store: { paymentId: string | null } = { paymentId: null };
    let made = 0;
    createCustomer.mockImplementation(
      async (_params: unknown, options?: { idempotencyKey?: string }) => ({
        id: options?.idempotencyKey ? `cus_${options.idempotencyKey}` : `cus_${++made}`,
      })
    );
    const subscriptionService = {
      updateCustomerId: jest.fn(async (_org: string, id: string) => {
        store.paymentId = id;
      }),
      assignCustomerId: jest.fn(
        async (_org: string, expected: string | null, id: string) => {
          if (store.paymentId !== expected) return false;
          store.paymentId = id;
          return true;
        }
      ),
      getPaymentId: jest.fn(async () => store.paymentId),
    };
    const organizationService = {
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
    return { service, store };
  };

  it('ends with one customer, the stored one, for both', async () => {
    const { service, store } = race();
    const [first, second] = await Promise.all([
      service.createOrGetCustomer(org(null) as any),
      service.createOrGetCustomer(org(null) as any),
    ]);
    expect(first).toBe(second);
    expect(store.paymentId).toBe(first);
  });

  it('drops a customer it made but could not store, and uses the stored one', async () => {
    const { service, store } = race();
    store.paymentId = 'cus_winner';
    createCustomer.mockResolvedValueOnce({ id: 'cus_loser' });

    await expect(service.createOrGetCustomer(org(null) as any)).resolves.toBe('cus_winner');
    expect(deleteCustomer).toHaveBeenCalledWith('cus_loser');
    expect(store.paymentId).toBe('cus_winner');
  });
});

describe('a checkout for an organisation that already pays (BILL-1)', () => {
  // A checkout always starts a new subscription: an organisation with a live
  // one got a second on the same customer, and cancelling stopped only one.
  it('is refused with 409, without opening a checkout session', async () => {
    retrieveCustomer.mockResolvedValueOnce({ id: 'cus_live', deleted: false });
    listSubscriptions.mockResolvedValueOnce({ data: [{ id: 'sub_1', status: 'active' }] });
    const { service } = build('cus_live');

    await expect(
      service.embedded('u1', 'org-1', 'user-1', { billing: 'PRO', period: 'MONTHLY' } as any, false)
    ).rejects.toMatchObject({ status: 409 });
  });
});
