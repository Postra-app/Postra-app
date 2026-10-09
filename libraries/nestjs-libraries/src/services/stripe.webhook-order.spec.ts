const retrieveSubscription = jest.fn();
const listSubscriptions = jest.fn();
const updateSubscription = jest.fn();
const cancelSubscription = jest.fn().mockResolvedValue({});
const listInvoices = jest.fn();
const listInvoicePayments = jest.fn();
const createRefund = jest.fn();
const listRefunds = jest.fn();

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: {
      retrieve: retrieveSubscription,
      list: listSubscriptions,
      update: updateSubscription,
      cancel: cancelSubscription,
    },
    invoices: { list: listInvoices },
    invoicePayments: { list: listInvoicePayments },
    refunds: { create: createRefund, list: listRefunds },
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

const sub = (status: string, billing = 'PRO', extra: object = {}) => ({
  id: 'sub_1',
  customer: 'cus_1',
  status,
  cancel_at: null,
  metadata: { billing, period: 'MONTHLY', uniqueId: 'u1' },
  ...extra,
});

const event = (type: string, object: object) =>
  ({ id: 'evt_1', type, data: { object } } as any);

const build = () => {
  const subscriptionService = {
    createOrUpdateSubscription: jest.fn().mockResolvedValue({}),
    deleteSubscription: jest.fn().mockResolvedValue(undefined),
  };
  // allowTrial false: the £1 card probe is skipped, which is not under test.
  const organizationService = {
    getOrgByCustomerId: jest.fn().mockResolvedValue({ id: 'org-1', allowTrial: false }),
  };
  const notificationService = { inAppNotification: jest.fn().mockResolvedValue(undefined) };
  const service = new StripeService(
    subscriptionService as any,
    organizationService as any,
    {} as any,
    {} as any,
    notificationService as any
  );
  return { service, subscriptionService, notificationService };
};

beforeEach(() => {
  jest.clearAllMocks();
  // No other subscription for the customer unless a test says so.
  listSubscriptions.mockResolvedValue({ data: [] });
  // The duplicate was never paid unless a test says so.
  listInvoices.mockResolvedValue({ data: [] });
  listInvoicePayments.mockResolvedValue({ data: [] });
  createRefund.mockImplementation(async () => ({ amount: 2900 }));
  listRefunds.mockResolvedValue({ data: [] });
});

describe('subscription events are written from Stripe’s current state', () => {
  it('a late update does not bring back a cancelled plan', async () => {
    retrieveSubscription.mockResolvedValue(sub('canceled'));
    const { service, subscriptionService } = build();

    await service.updateSubscription(event('customer.subscription.updated', sub('active')));

    expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
  });

  it('an older update does not restore an older tier', async () => {
    retrieveSubscription.mockResolvedValue(sub('active', 'ULTIMATE'));
    const { service, subscriptionService } = build();

    await service.updateSubscription(
      event('customer.subscription.updated', sub('active', 'STANDARD'))
    );

    const call = subscriptionService.createOrUpdateSubscription.mock.calls[0];
    expect(call[4]).toBe('ULTIMATE');
  });

  it('past_due keeps the paid plan instead of turning it into a trial', async () => {
    retrieveSubscription.mockResolvedValue(sub('past_due'));
    const { service, subscriptionService } = build();

    await service.updateSubscription(event('customer.subscription.updated', sub('past_due')));

    expect(subscriptionService.createOrUpdateSubscription.mock.calls[0][0]).toBe(false);
  });

  it('stores Stripe’s billing anchor, where the AI allowance month starts (E2E-07-40)', async () => {
    // Trial ended early on 2026-10-09 09:35:51: invoices run from then, not
    // from the day the subscription was created.
    retrieveSubscription.mockResolvedValue(sub('active', 'PRO', { billing_cycle_anchor: 1791538551 }));
    const { service, subscriptionService } = build();

    await service.updateSubscription(event('customer.subscription.updated', sub('active')));

    expect(subscriptionService.createOrUpdateSubscription.mock.calls[0][9]).toEqual(
      new Date('2026-10-09T09:35:51.000Z')
    );
  });

  it('trialing is still a trial', async () => {
    retrieveSubscription.mockResolvedValue(sub('trialing'));
    const { service, subscriptionService } = build();

    await service.createSubscription(event('customer.subscription.created', sub('trialing')));

    expect(subscriptionService.createOrUpdateSubscription.mock.calls[0][0]).toBe(true);
  });

  it('a failure while writing reaches the webhook, so Stripe retries', async () => {
    retrieveSubscription.mockResolvedValue(sub('active'));
    const { service, subscriptionService } = build();
    subscriptionService.createOrUpdateSubscription.mockRejectedValue(new Error('db down'));

    await expect(
      service.updateSubscription(event('customer.subscription.updated', sub('active')))
    ).rejects.toThrow('db down');
  });
});

describe('customer.subscription.deleted', () => {
  it('keeps the plan when the customer already bought a new subscription', async () => {
    listSubscriptions.mockResolvedValue({
      data: [sub('canceled'), { ...sub('active'), id: 'sub_2' }],
    });
    const { service, subscriptionService } = build();

    await service.deleteSubscription(event('customer.subscription.deleted', sub('canceled')));

    expect(subscriptionService.deleteSubscription).not.toHaveBeenCalled();
  });

  it('downgrades when nothing else is live', async () => {
    listSubscriptions.mockResolvedValue({ data: [sub('canceled')] });
    const { service, subscriptionService } = build();

    await service.deleteSubscription(event('customer.subscription.deleted', sub('canceled')));

    expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith('cus_1');
  });
});

describe('finishing a trial early', () => {
  it('says so when there is no trial to finish', async () => {
    listSubscriptions.mockResolvedValue({ data: [sub('active')] });
    const { service } = build();

    await expect(service.finishTrial('cus_1')).resolves.toEqual({
      finish: false,
      reason: 'no-trial',
    });
  });

  it('hands back the invoice link when the bank asks for 3-D Secure', async () => {
    listSubscriptions.mockResolvedValue({ data: [sub('trialing')] });
    updateSubscription.mockResolvedValue({
      ...sub('past_due'),
      latest_invoice: { hosted_invoice_url: 'https://invoice.stripe.com/i/x' },
    });
    const { service } = build();

    await expect(service.finishTrial('cus_1')).resolves.toEqual({
      finish: false,
      reason: 'payment-incomplete',
      url: 'https://invoice.stripe.com/i/x',
    });
  });

  it('finishes when the charge goes through', async () => {
    listSubscriptions.mockResolvedValue({ data: [sub('trialing')] });
    updateSubscription.mockResolvedValue(sub('active'));
    const { service } = build();

    await expect(service.finishTrial('cus_1')).resolves.toEqual({ finish: true });
  });
});

// Upstream 28e71678: two checkouts at once left two live subscriptions, both
// charging. The older one is the plan; a newer one is cancelled.
describe('a second live subscription for the same customer', () => {
  const older = { id: 'sub_0', customer: 'cus_1', status: 'active', created: 100 };

  it('the newer one is cancelled and the customer told, the plan is not rewritten', async () => {
    retrieveSubscription.mockResolvedValue(sub('active', 'PRO', { created: 200 }));
    listSubscriptions.mockResolvedValue({ data: [older, { ...sub('active'), created: 200 }] });
    const { service, subscriptionService, notificationService } = build();

    const res = await service.createSubscription(
      event('customer.subscription.created', sub('active', 'PRO', { created: 200 }))
    );

    expect(cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(res).toMatchObject({ skipped: 'duplicate subscription' });
    // Stripe's default page of 10 could hide the older plan behind abandoned
    // checkouts.
    expect(listSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
    expect(notificationService.inAppNotification).toHaveBeenCalled();
  });

  // E2E-07-30: the duplicate's payment comes back by itself.
  it('a paid duplicate is refunded, once per payment, and the customer told the amount', async () => {
    retrieveSubscription.mockResolvedValue(sub('active', 'PRO', { created: 200 }));
    listSubscriptions.mockResolvedValue({ data: [older, { ...sub('active'), created: 200 }] });
    listInvoices.mockResolvedValue({ data: [{ id: 'in_1', amount_paid: 2900 }] });
    listInvoicePayments.mockResolvedValue({
      data: [{ id: 'inpay_1', payment: { type: 'payment_intent', payment_intent: 'pi_1' } }],
    });
    const { service, notificationService } = build();

    await service.createSubscription(
      event('customer.subscription.created', sub('active', 'PRO', { created: 200 }))
    );

    expect(listInvoices).toHaveBeenCalledWith(expect.objectContaining({ subscription: 'sub_1', status: 'paid' }));
    expect(createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_1', reason: 'duplicate' }),
      { idempotencyKey: 'duplicate-refund-inpay_1' }
    );
    expect(notificationService.inAppNotification.mock.calls[0][2]).toContain('refunded its payment of £29.00');
  });

  it('a duplicate that took no money is not refunded, and the message says so', async () => {
    retrieveSubscription.mockResolvedValue(sub('active', 'PRO', { created: 200 }));
    listSubscriptions.mockResolvedValue({ data: [older, { ...sub('active'), created: 200 }] });
    listInvoices.mockResolvedValue({ data: [{ id: 'in_1', amount_paid: 0 }] });
    const { service, notificationService } = build();

    await service.createSubscription(
      event('customer.subscription.created', sub('active', 'PRO', { created: 200 }))
    );

    expect(createRefund).not.toHaveBeenCalled();
    expect(notificationService.inAppNotification.mock.calls[0][2]).toContain('Nothing was charged');
  });

  it('a refund Stripe refuses leaves the cancel in place and asks the customer to contact us', async () => {
    retrieveSubscription.mockResolvedValue(sub('active', 'PRO', { created: 200 }));
    listSubscriptions.mockResolvedValue({ data: [older, { ...sub('active'), created: 200 }] });
    listInvoices.mockResolvedValue({ data: [{ id: 'in_1', amount_paid: 2900 }] });
    listInvoicePayments.mockResolvedValue({
      data: [{ id: 'inpay_1', payment: { type: 'payment_intent', payment_intent: 'pi_1' } }],
    });
    createRefund.mockRejectedValue(new Error('charge_already_refunded'));
    const { service, notificationService } = build();

    const res = await service.createSubscription(
      event('customer.subscription.created', sub('active', 'PRO', { created: 200 }))
    );

    expect(cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(res).toMatchObject({ skipped: 'duplicate subscription' });
    expect(notificationService.inAppNotification.mock.calls[0][2]).toContain('contact us');
  });

  // Codex review 10-06: a crash between refund and cancel must not lose the
  // refund nor repeat it.
  it('refunds before cancelling, and a retry does not refund again', async () => {
    retrieveSubscription.mockResolvedValue(sub('active', 'PRO', { created: 200 }));
    listSubscriptions.mockResolvedValue({ data: [older, { ...sub('active'), created: 200 }] });
    listInvoices.mockResolvedValue({ data: [{ id: 'in_1', amount_paid: 2900 }] });
    listInvoicePayments.mockResolvedValue({
      data: [{ id: 'inpay_1', payment: { type: 'payment_intent', payment_intent: 'pi_1' } }],
    });
    const order: string[] = [];
    createRefund.mockImplementation(async () => (order.push('refund'), { amount: 2900 }));
    cancelSubscription.mockImplementationOnce(async () => {
      order.push('cancel');
      throw new Error('process died');
    });
    const { service, notificationService } = build();
    const evt = event('customer.subscription.created', sub('active', 'PRO', { created: 200 }));

    await expect(service.createSubscription(evt)).rejects.toThrow('process died');
    expect(order).toEqual(['refund', 'cancel']);

    // Stripe retries; the duplicate is still live and already refunded.
    listRefunds.mockResolvedValue({ data: [{ amount: 2900, status: 'succeeded' }] });
    cancelSubscription.mockResolvedValue({});
    await service.createSubscription(evt);
    expect(createRefund).toHaveBeenCalledTimes(1);
    expect(cancelSubscription).toHaveBeenLastCalledWith('sub_1');
    expect(notificationService.inAppNotification.mock.calls.at(-1)[2]).toContain('£29.00');
  });

  it('the older one is kept and written as usual', async () => {
    retrieveSubscription.mockResolvedValue(sub('active', 'PRO', { created: 50 }));
    listSubscriptions.mockResolvedValue({ data: [older, { ...sub('active'), created: 50 }] });
    const { service, subscriptionService } = build();

    await service.updateSubscription(
      event('customer.subscription.updated', sub('active', 'PRO', { created: 50 }))
    );

    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalled();
  });

  it('an incomplete checkout next to the plan is not a duplicate of it', async () => {
    retrieveSubscription.mockResolvedValue(sub('active', 'PRO', { created: 200 }));
    listSubscriptions.mockResolvedValue({
      data: [{ ...older, status: 'incomplete' }, { ...sub('active'), created: 200 }],
    });
    const { service, subscriptionService } = build();

    await service.updateSubscription(
      event('customer.subscription.updated', sub('active', 'PRO', { created: 200 }))
    );

    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalled();
  });
});
