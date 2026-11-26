const retrieveSubscription = jest.fn();
const listSubscriptions = jest.fn();
const createPreview = jest.fn();

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: { retrieve: retrieveSubscription, list: listSubscriptions },
    invoices: { createPreview, list: jest.fn().mockResolvedValue({ data: [] }) },
  }));
  mock.errors = actual.errors ?? actual.default?.errors;
  return mock;
});

// Importing these for real drags in integration.manager → nostr-tools (ESM).
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({ TrackService: class {} }));

import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';

// A trial without a card is told two things a trial with a card is not:
// two days in, that a card keeps the plan and that without one publishing
// stops (nothing will be charged); and at the end, that the trial has ended
// and everything is saved.

// 1 December 2026, 15:00 UTC.
const TRIAL_END = Date.UTC(2026, 11, 1, 15, 0, 0) / 1000;
let n = 0;

const noCardTrial = (over: Record<string, unknown> = {}) => ({
  id: `sub_nc${++n}`,
  status: 'trialing',
  trial_end: TRIAL_END,
  cancel_at_period_end: false,
  cancel_at: null,
  customer: { id: 'cus_1', invoice_settings: { default_payment_method: null } },
  default_payment_method: null,
  metadata: { service: 'gitroom', billing: 'PRO', period: 'MONTHLY', uniqueId: 'u1', trial_no_card: '1' },
  items: { data: [{ quantity: 1, price: { id: 'price_1', unit_amount: 2900, recurring: { interval: 'month' }, product: { id: 'prod_1', metadata: { tier: 'PRO' } } } }] },
  ...over,
});

const build = () => {
  const organizationService = { getOrgByCustomerId: jest.fn().mockResolvedValue({ id: 'org-1' }) };
  const subscriptionService = { deleteSubscription: jest.fn().mockResolvedValue(true) };
  const notificationService = { inAppNotification: jest.fn().mockResolvedValue(undefined) };
  const service = new StripeService(subscriptionService as any, organizationService as any, {} as any, {} as any, notificationService as any);
  return { service, notificationService, subscriptionService };
};

const frontend = process.env.FRONTEND_URL;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.FRONTEND_URL = 'https://app.example.test';
  createPreview.mockResolvedValue({ amount_due: 2900 });
  listSubscriptions.mockResolvedValue({ data: [] });
});
afterAll(() => {
  process.env.FRONTEND_URL = frontend;
});

describe('two days into a trial without a card', () => {
  const event = (id: string) => ({ id: 'evt_1', type: 'customer.subscription.trial_will_end', data: { object: { id, customer: 'cus_1' } } }) as any;

  it('says a card keeps the plan, and that without one publishing stops and nothing is charged', async () => {
    const sub = noCardTrial();
    retrieveSubscription.mockResolvedValue(sub);
    const { service, notificationService } = build();

    await service.trialWillEnd(event(sub.id));

    expect(notificationService.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      'Your Postra trial ends on 1 December',
      'Your free trial of Postra Pro ends on 1 December. To keep your plan, add a card in Billing: https://app.example.test/billing. Without a card, nothing is charged: publishing stops when the trial ends, and your channels, posts and media stay saved for when you choose a plan.',
      true,
      false,
      'info'
    );
    expect(notificationService.inAppNotification.mock.calls[0][2]).not.toContain('will be charged');
  });

  it('once a card is added, says what it will be charged, as for any trial', async () => {
    const sub = noCardTrial({ customer: { id: 'cus_1', invoice_settings: { default_payment_method: { id: 'pm_1', card: { last4: '4242' } } } } });
    retrieveSubscription.mockResolvedValue(sub);
    const { service, notificationService } = build();

    await service.trialWillEnd(event(sub.id));

    expect(notificationService.inAppNotification.mock.calls[0][2]).toContain('your card ending 4242 will be charged £29 a month');
  });
});

describe('when a trial without a card ends', () => {
  const deleted = (object: Record<string, unknown>) => ({ id: 'evt_2', type: 'customer.subscription.deleted', data: { object } }) as any;

  it('ends the plan and says the trial has ended and everything is saved, once', async () => {
    const sub = noCardTrial({ status: 'canceled', canceled_at: TRIAL_END, customer: 'cus_1' });
    const { service, notificationService, subscriptionService } = build();

    await service.deleteSubscription(deleted(sub));
    // Stripe redelivers an event it did not see answered.
    await service.deleteSubscription(deleted(sub));

    expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith('cus_1', 'u1');
    expect(notificationService.inAppNotification).toHaveBeenCalledTimes(1);
    expect(notificationService.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      'Your free trial has ended',
      'Your free trial of Postra Pro has ended. Your channels, posts and media are saved. Choose a plan and add a card to carry on: https://app.example.test/billing',
      true,
      false,
      'info'
    );
  });

  it('says nothing when the trial was cancelled before its end, or refused', async () => {
    const { service, notificationService } = build();

    await service.deleteSubscription(deleted(noCardTrial({ status: 'canceled', canceled_at: TRIAL_END - 86400, customer: 'cus_1' })));
    await service.deleteSubscription(
      deleted(noCardTrial({ status: 'canceled', canceled_at: TRIAL_END, customer: 'cus_1', metadata: { ...noCardTrial().metadata, trial_rejected: 'email' } }))
    );

    expect(notificationService.inAppNotification).not.toHaveBeenCalled();
  });

  it('says nothing for a paid plan that ends', async () => {
    const { service, notificationService } = build();

    await service.deleteSubscription(
      deleted(noCardTrial({ status: 'canceled', canceled_at: TRIAL_END + 30 * 86400, customer: 'cus_1', metadata: { billing: 'PRO', uniqueId: 'u1' } }))
    );

    expect(notificationService.inAppNotification).not.toHaveBeenCalled();
  });
});

// A notice that failed is sent again with Stripe's retry of the event: the
// once-only mark was taken before the notice and kept it from the retry.
describe('a trial-ended notice that failed', () => {
  it('is sent on the retried event', async () => {
    const sub = noCardTrial({ status: 'canceled', canceled_at: TRIAL_END, customer: 'cus_1' });
    const { service, notificationService } = build();
    notificationService.inAppNotification.mockRejectedValueOnce(new Error('mail down'));
    const event = { id: 'evt_3', type: 'customer.subscription.deleted', data: { object: sub } } as any;

    await expect(service.deleteSubscription(event)).rejects.toThrow('mail down');
    await service.deleteSubscription(event);

    expect(notificationService.inAppNotification).toHaveBeenCalledTimes(2);
  });
});
