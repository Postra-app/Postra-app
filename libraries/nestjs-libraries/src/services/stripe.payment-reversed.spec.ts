const retrieveCharge = jest.fn();
const listRefunds = jest.fn();
const listInvoicePayments = jest.fn();
const retrieveInvoice = jest.fn();
const retrieveSubscription = jest.fn();
const listSubscriptions = jest.fn();
const cancelSubscription = jest.fn();

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    charges: { retrieve: retrieveCharge },
    refunds: { list: listRefunds },
    invoicePayments: { list: listInvoicePayments },
    invoices: { retrieve: retrieveInvoice, list: jest.fn() },
    subscriptions: {
      retrieve: retrieveSubscription,
      list: listSubscriptions,
      cancel: cancelSubscription,
    },
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

// E2E-11-363: a chargeback or a refund of the whole payment left the plan in
// place, and the tier was read from metadata anyone with Dashboard access (or
// a stray API call) could change while the price stayed Starter.

const charge = {
  id: 'ch_1',
  customer: 'cus_1',
  payment_intent: 'pi_1',
  amount: 2900,
  amount_refunded: 2900,
  refunded: true,
};
const live = {
  id: 'sub_1',
  status: 'active',
  customer: 'cus_1',
  metadata: { service: 'gitroom', uniqueId: 'u1' },
};

const build = (org: unknown = { id: 'org-1' }) => {
  const organizationService = {
    getOrgByCustomerId: jest.fn().mockResolvedValue(org),
  };
  const subscriptionService = {
    deleteSubscription: jest.fn().mockResolvedValue(true),
    createOrUpdateSubscription: jest.fn().mockResolvedValue({}),
    getSubscription: jest.fn().mockResolvedValue(null),
  };
  const notificationService = {
    inAppNotification: jest.fn().mockResolvedValue(undefined),
  };
  const service = new StripeService(
    subscriptionService as any,
    organizationService as any,
    {} as any,
    {} as any,
    notificationService as any
  );
  jest.spyOn(service as any, 'releaseSchedule').mockResolvedValue(undefined);
  jest.spyOn(service, 'voidUnpaidInvoices').mockResolvedValue(undefined);
  return { service, subscriptionService, notificationService };
};

const refunded = (object: Record<string, unknown> = charge) =>
  ({ type: 'charge.refunded', data: { object } }) as any;
const disputed = () =>
  ({
    type: 'charge.dispute.created',
    data: { object: { id: 'dp_1', charge: 'ch_1' } },
  }) as any;

beforeEach(() => {
  jest.clearAllMocks();
  retrieveCharge.mockResolvedValue(charge);
  listRefunds.mockResolvedValue({ data: [{ id: 're_1', reason: 'requested_by_customer' }] });
  listInvoicePayments.mockResolvedValue({ data: [{ invoice: 'in_1' }] });
  retrieveInvoice.mockResolvedValue({
    id: 'in_1',
    parent: { subscription_details: { subscription: 'sub_1' } },
  });
  retrieveSubscription.mockResolvedValue(live);
  listSubscriptions.mockResolvedValue({ data: [{ ...live, status: 'canceled' }] });
  cancelSubscription.mockResolvedValue({ ...live, status: 'canceled' });
});

describe('a chargeback or a full refund ends the plan it paid for', () => {
  it('a dispute cancels the subscription and drops the plan', async () => {
    const { service, subscriptionService, notificationService } = build();
    const res = await service.paymentReversed(disputed());
    expect(retrieveCharge).toHaveBeenCalledWith('ch_1');
    expect(cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith('cus_1', 'u1');
    expect(notificationService.inAppNotification).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true, ended: ['sub_1'] });
  });

  it('a full refund does the same', async () => {
    const { service, subscriptionService } = build();
    await service.paymentReversed(refunded());
    expect(listInvoicePayments).toHaveBeenCalledWith({
      payment: { type: 'payment_intent', payment_intent: 'pi_1' },
      limit: 10,
    });
    expect(cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(subscriptionService.deleteSubscription).toHaveBeenCalled();
  });

  it('a partial refund changes nothing', async () => {
    const { service, subscriptionService } = build();
    const res = await service.paymentReversed(
      refunded({ ...charge, refunded: false, amount_refunded: 1000 })
    );
    expect(res).toEqual({ ok: true, skipped: 'partial refund' });
    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(subscriptionService.deleteSubscription).not.toHaveBeenCalled();
  });

  it('the refund of a cancelled duplicate leaves the real plan alone', async () => {
    listRefunds.mockResolvedValue({ data: [{ id: 're_1', reason: 'duplicate' }] });
    const { service } = build();
    const res = await service.paymentReversed(refunded());
    expect(res).toEqual({ ok: true, skipped: 'refund of a duplicate subscription' });
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it('a charge of another business on the shared account is ignored', async () => {
    const { service } = build(null);
    const res = await service.paymentReversed(disputed());
    expect(res).toEqual({ ok: true, skipped: 'not a Postra customer' });
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it('a released card check (no invoice behind the payment) is ignored', async () => {
    listInvoicePayments.mockResolvedValue({ data: [] });
    const { service } = build();
    const res = await service.paymentReversed(refunded());
    expect(res).toEqual({ ok: true, skipped: 'payment of no subscription' });
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it('a subscription that already ended is not cancelled again', async () => {
    retrieveSubscription.mockResolvedValue({ ...live, status: 'canceled' });
    const { service, subscriptionService } = build();
    const res = await service.paymentReversed(refunded());
    expect(res).toEqual({ ok: true, skipped: 'subscription already ended' });
    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(subscriptionService.deleteSubscription).not.toHaveBeenCalled();
  });

  it('another live subscription keeps the plan row', async () => {
    listSubscriptions.mockResolvedValue({
      data: [
        { ...live, status: 'canceled' },
        { id: 'sub_2', status: 'active' },
      ],
    });
    const { service, subscriptionService } = build();
    await service.paymentReversed(refunded());
    expect(cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(subscriptionService.deleteSubscription).not.toHaveBeenCalled();
  });
});

describe('the tier comes from the price, not the metadata', () => {
  const sub = (product: unknown, metadata: Record<string, string>, interval = 'month') => ({
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    metadata: { uniqueId: 'u1', ...metadata },
    items: {
      data: [{ price: { id: 'price_1', product, recurring: { interval } } }],
    },
    cancel_at: null,
    billing_cycle_anchor: 1_700_000_000,
  });

  const sync = async (subscription: unknown) => {
    retrieveSubscription.mockResolvedValue(subscription);
    const { service, subscriptionService } = build();
    jest.spyOn(service as any, 'newTrial').mockResolvedValue(null);
    jest.spyOn(service as any, 'checkValidCard').mockResolvedValue(true);
    listSubscriptions.mockResolvedValue({ data: [subscription] });
    await (service as any).syncSubscription({ data: { object: { id: 'sub_1' } } });
    expect(retrieveSubscription).toHaveBeenCalledWith('sub_1', {
      expand: ['items.data.price.product'],
    });
    const call = subscriptionService.createOrUpdateSubscription.mock.calls[0];
    return { billing: call?.[4], period: call?.[5] };
  };

  it('Business in the metadata on a Starter price writes Starter', async () => {
    expect(
      await sync(
        sub(
          { id: 'prod_s', name: 'Postra Starter', metadata: { tier: 'STANDARD' } },
          { billing: 'ULTIMATE', period: 'MONTHLY' }
        )
      )
    ).toEqual({ billing: 'STANDARD', period: 'MONTHLY' });
  });

  it('the period comes from the price interval', async () => {
    expect(
      await sync(
        sub(
          { id: 'prod_p', name: 'Postra Pro', metadata: { tier: 'PRO' } },
          { billing: 'PRO', period: 'MONTHLY' },
          'year'
        )
      )
    ).toEqual({ billing: 'PRO', period: 'YEARLY' });
  });

  it('a product without a tier falls back to the metadata', async () => {
    expect(
      await sync(
        sub({ id: 'prod_x', name: 'Something else', metadata: {} }, {
          billing: 'PRO',
          period: 'MONTHLY',
        })
      )
    ).toEqual({ billing: 'PRO', period: 'MONTHLY' });
  });

  it('a legacy product named after the tier still maps', async () => {
    expect(
      await sync(sub({ id: 'prod_u', name: 'ULTIMATE', metadata: {} }, { billing: 'STANDARD', period: 'MONTHLY' }))
    ).toEqual({ billing: 'ULTIMATE', period: 'MONTHLY' });
  });
});
