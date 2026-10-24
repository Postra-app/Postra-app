const updateSubscription = jest.fn();
const retrieveInvoice = jest.fn();
const listSubscriptions = jest.fn();
const retrieveSubscription = jest.fn();
const listPrices = jest.fn();

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: {
      update: updateSubscription,
      list: listSubscriptions,
      retrieve: retrieveSubscription,
    },
    invoices: { retrieve: retrieveInvoice },
    prices: { list: listPrices, create: jest.fn() },
  }));
  mock.errors = actual.errors ?? actual.default?.errors;
  return mock;
});

// Importing these for real drags in integration.manager → nostr-tools (ESM).
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/users/users.service',
  () => ({ UsersService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({
  TrackService: class {},
}));

import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';

// Upstream 3adec5ef5 / 96e037ee7 (24 X 2026): a plan change whose proration
// invoice is not paid at once does not throw. Stripe moves the subscription
// to past_due, the API answered { id } and the page said "Subscription
// updated successfully" to a customer whose card was declined or whose bank
// wanted 3-D Secure, while the webhook wrote the higher tier from the
// metadata before any money came in.
const live = {
  id: 'sub_live',
  status: 'active',
  items: { data: [{ id: 'si_1', price: { id: 'price_standard' } }] },
  metadata: { billing: 'STANDARD', period: 'MONTHLY' },
  current_period_end: 1_900_000_000,
};
const body = { billing: 'PRO', period: 'MONTHLY' } as any;

const build = () => {
  const organizationService = {
    getOrgById: jest
      .fn()
      .mockResolvedValue({ id: 'org-1', paymentId: 'cus_1' }),
    getOrgByCustomerId: jest.fn().mockResolvedValue({ id: 'org-1' }),
  };
  const subscriptionService = {
    getSubscription: jest
      .fn()
      .mockResolvedValue({ subscriptionTier: 'STANDARD', period: 'MONTHLY' }),
    createOrUpdateSubscription: jest.fn().mockResolvedValue({}),
  };
  const service = new StripeService(
    subscriptionService as any,
    organizationService as any,
    {} as any,
    {} as any,
    {} as any
  );
  jest.spyOn(service as any, 'createOrGetCustomer').mockResolvedValue('cus_1');
  jest
    .spyOn(service as any, 'findOrCreateProduct')
    .mockResolvedValue({ id: 'prod_pro' });
  jest.spyOn(service as any, 'releaseSchedule').mockResolvedValue(undefined);
  jest
    .spyOn(service as any, 'createBillingPortalLink')
    .mockResolvedValue({ url: 'https://portal.example' });
  return { service, subscriptionService };
};

const intent = (status: string) => ({
  id: 'in_1',
  status: 'open',
  payments: { data: [{ payment: { payment_intent: { id: 'pi_1', status } } }] },
});

beforeEach(() => {
  jest.clearAllMocks();
  listPrices.mockResolvedValue({
    data: [
      {
        id: 'price_pro',
        currency: 'gbp',
        unit_amount: 2900,
        recurring: { interval: 'month' },
      },
    ],
  });
  listSubscriptions.mockResolvedValue({ data: [live] });
});

describe('a plan change that is not paid at once', () => {
  it('a paid change answers the id, as before', async () => {
    updateSubscription.mockResolvedValue({
      status: 'active',
      latest_invoice: { id: 'in_1', status: 'paid' },
    });
    const { service } = build();
    expect(
      await service.subscribe('track', 'org-1', 'user-1', body, false)
    ).toEqual({ id: expect.any(String) });
    expect(retrieveInvoice).not.toHaveBeenCalled();
  });

  it('a change during the trial stays trialing and is a success (Codex, 24 X)', async () => {
    updateSubscription.mockResolvedValue({
      status: 'trialing',
      latest_invoice: { id: 'in_0', status: 'paid' },
    });
    listSubscriptions.mockResolvedValue({
      data: [{ ...live, status: 'trialing' }],
    });
    const { service } = build();
    expect(
      await service.subscribe('track', 'org-1', 'user-1', body, false)
    ).toEqual({ id: expect.any(String) });
    expect(retrieveInvoice).not.toHaveBeenCalled();
  });

  it('a declined card sends the customer to the portal instead of saying success', async () => {
    updateSubscription.mockResolvedValue({
      status: 'past_due',
      latest_invoice: {
        id: 'in_1',
        status: 'open',
        hosted_invoice_url: 'https://invoice.example',
      },
    });
    retrieveInvoice.mockResolvedValue(intent('requires_payment_method'));
    const { service } = build();
    expect(
      await service.subscribe('track', 'org-1', 'user-1', body, false)
    ).toEqual({ portal: 'https://portal.example' });
    expect(retrieveInvoice).toHaveBeenCalledWith('in_1', {
      expand: ['payments.data.payment.payment_intent'],
    });
  });

  it('a bank that wants 3-D Secure gets the hosted invoice to confirm on', async () => {
    updateSubscription.mockResolvedValue({
      status: 'past_due',
      latest_invoice: {
        id: 'in_1',
        status: 'open',
        hosted_invoice_url: 'https://invoice.example',
      },
    });
    retrieveInvoice.mockResolvedValue(intent('requires_action'));
    const { service } = build();
    expect(
      await service.subscribe('track', 'org-1', 'user-1', body, false)
    ).toEqual({
      id: expect.any(String),
      paymentIncomplete: true,
      url: 'https://invoice.example',
    });
  });

  it('the webhook keeps the paid tier while the change is past_due', async () => {
    const { service, subscriptionService } = build();
    retrieveSubscription.mockResolvedValue({
      id: 'sub_live',
      status: 'past_due',
      customer: 'cus_1',
      metadata: { billing: 'PRO', period: 'MONTHLY', uniqueId: 'u1' },
      cancel_at: null,
      billing_cycle_anchor: 1_700_000_000,
    });
    jest.spyOn(service as any, 'newTrial').mockResolvedValue(null);
    jest.spyOn(service as any, 'checkValidCard').mockResolvedValue(true);

    await (service as any).syncSubscription({
      data: { object: { id: 'sub_live' } },
    });

    const [, , , , billing, period] =
      subscriptionService.createOrUpdateSubscription.mock.calls[0];
    expect(billing).toBe('STANDARD');
    expect(period).toBe('MONTHLY');
  });

  it('the webhook writes the new tier once the change is active', async () => {
    const { service, subscriptionService } = build();
    retrieveSubscription.mockResolvedValue({
      id: 'sub_live',
      status: 'active',
      customer: 'cus_1',
      metadata: { billing: 'PRO', period: 'MONTHLY', uniqueId: 'u1' },
      cancel_at: null,
      billing_cycle_anchor: 1_700_000_000,
    });
    jest.spyOn(service as any, 'newTrial').mockResolvedValue(null);
    jest.spyOn(service as any, 'checkValidCard').mockResolvedValue(true);

    await (service as any).syncSubscription({
      data: { object: { id: 'sub_live' } },
    });

    expect(
      subscriptionService.createOrUpdateSubscription.mock.calls[0][4]
    ).toBe('PRO');
  });
});
