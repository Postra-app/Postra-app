const retrieveSubscription = jest.fn();
const createPreview = jest.fn();

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: { retrieve: retrieveSubscription },
    invoices: { createPreview },
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

// Stripe's own trial reminder named the shared Stripe account and went out
// within seconds of a trial that Postra then refused. The reminder is now
// Postra's: one mail three days before the trial ends, only for a trial that
// will really be charged.

// 23 November 2026, 12:21 UTC.
const TRIAL_END = Date.UTC(2026, 10, 23, 12, 21, 9) / 1000;

const subscription = (over: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  status: 'trialing',
  trial_end: TRIAL_END,
  cancel_at_period_end: false,
  cancel_at: null,
  customer: {
    id: 'cus_1',
    invoice_settings: { default_payment_method: null },
  },
  default_payment_method: { id: 'pm_1', card: { last4: '5290' } },
  metadata: { service: 'gitroom', billing: 'STANDARD', period: 'MONTHLY' },
  items: {
    data: [
      {
        quantity: 1,
        price: {
          id: 'price_1',
          unit_amount: 1900,
          recurring: { interval: 'month' },
          product: { id: 'prod_1', metadata: { tier: 'STANDARD' } },
        },
      },
    ],
  },
  ...over,
});

const event = {
  id: 'evt_1',
  type: 'customer.subscription.trial_will_end',
  data: { object: { id: 'sub_1', customer: 'cus_1' } },
} as any;

const build = (org: unknown = { id: 'org-1' }) => {
  const organizationService = {
    getOrgByCustomerId: jest.fn().mockResolvedValue(org),
  };
  const notificationService = {
    inAppNotification: jest.fn().mockResolvedValue(undefined),
  };
  const service = new StripeService(
    {} as any,
    organizationService as any,
    {} as any,
    {} as any,
    notificationService as any
  );
  return { service, notificationService, organizationService };
};

describe('Stripe trial_will_end: Postra sends its own trial reminder', () => {
  const frontend = process.env.FRONTEND_URL;
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example.test';
    retrieveSubscription.mockReset();
    createPreview.mockReset();
    createPreview.mockResolvedValue({ amount_due: 1900 });
  });
  afterAll(() => {
    process.env.FRONTEND_URL = frontend;
  });

  it('mails the date, the plan, the card and the monthly amount', async () => {
    retrieveSubscription.mockResolvedValue(subscription());
    const { service, notificationService } = build();
    await service.trialWillEnd(event);
    expect(notificationService.inAppNotification).toHaveBeenCalledTimes(1);
    expect(notificationService.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      'Your Postra trial ends on 23 November',
      'Your free trial of Postra Starter ends on 23 November. After that, your card ending 5290 will be charged £19 a month. Want to keep going? There is nothing to do. To cancel or change your plan, open Billing: https://app.example.test/billing',
      true,
      false,
      'info'
    );
    expect(createPreview).toHaveBeenCalledWith({
      customer: 'cus_1',
      subscription: 'sub_1',
    });
  });

  it('a yearly plan is charged "a year", with the amount Stripe will ask for', async () => {
    retrieveSubscription.mockResolvedValue(
      subscription({
        metadata: { service: 'gitroom', billing: 'PRO', period: 'YEARLY' },
        items: {
          data: [
            {
              quantity: 1,
              price: {
                id: 'price_2',
                unit_amount: 29000,
                recurring: { interval: 'year' },
                product: { id: 'prod_2', metadata: { tier: 'PRO' } },
              },
            },
          ],
        },
      })
    );
    createPreview.mockResolvedValue({ amount_due: 26100 });
    const { service, notificationService } = build();
    await service.trialWillEnd(event);
    expect(notificationService.inAppNotification.mock.calls[0][2]).toContain(
      'Your free trial of Postra Pro ends on 23 November. After that, your card ending 5290 will be charged £261 a year.'
    );
  });

  it('the customer default card when the subscription has none, the price when there is no preview', async () => {
    retrieveSubscription.mockResolvedValue(
      subscription({
        default_payment_method: null,
        customer: {
          id: 'cus_1',
          invoice_settings: {
            default_payment_method: { id: 'pm_2', card: { last4: '4242' } },
          },
        },
      })
    );
    createPreview.mockRejectedValue(new Error('preview unavailable'));
    const { service, notificationService } = build();
    await service.trialWillEnd(event);
    expect(notificationService.inAppNotification.mock.calls[0][2]).toContain(
      'After that, your card ending 4242 will be charged £19 a month.'
    );
  });

  it('no card found: the card is left out', async () => {
    retrieveSubscription.mockResolvedValue(
      subscription({ default_payment_method: null })
    );
    const { service, notificationService } = build();
    await service.trialWillEnd(event);
    expect(notificationService.inAppNotification.mock.calls[0][2]).toContain(
      'After that, you will be charged £19 a month.'
    );
  });

  it.each([
    ['refused as a repeat trial', { metadata: { service: 'gitroom', trial_rejected: 'card' } }],
    ['cancelled at the end of the trial', { cancel_at_period_end: true }],
    ['set to cancel on a date', { cancel_at: TRIAL_END }],
    ['no longer trialing', { status: 'active' }],
    ['already cancelled', { status: 'canceled' }],
  ])('no mail for a trial %s', async (_name, over) => {
    retrieveSubscription.mockResolvedValue(subscription(over));
    const { service, notificationService } = build();
    const result = await service.trialWillEnd(event);
    expect(result).toMatchObject({ ok: true, skipped: expect.any(String) });
    expect(notificationService.inAppNotification).not.toHaveBeenCalled();
  });

  it('no mail when no organisation has this customer', async () => {
    retrieveSubscription.mockResolvedValue(subscription());
    const { service, notificationService } = build(null);
    await service.trialWillEnd(event);
    expect(notificationService.inAppNotification).not.toHaveBeenCalled();
  });
});
