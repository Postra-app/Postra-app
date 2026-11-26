const createSubscription = jest.fn();
const createSession = jest.fn().mockResolvedValue({ client_secret: 'cs_secret', url: 'https://checkout.example' });
const searchCustomers = jest.fn();
const updateCustomer = jest.fn().mockResolvedValue({});
const listPrices = jest.fn();
const retrieveSubscription = jest.fn();
const listSubscriptions = jest.fn();
const updateSubscription = jest.fn().mockResolvedValue({});
const cancelSubscription = jest.fn().mockResolvedValue({});
const listMethods = jest.fn();
const createIntent = jest.fn();
const retrieveCustomer = jest.fn();
const createPortal = jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/p/x' });

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: createSession } },
    customers: { search: searchCustomers, update: updateCustomer, retrieve: retrieveCustomer },
    prices: { list: listPrices, create: jest.fn().mockResolvedValue({ id: 'price_new' }) },
    subscriptions: {
      create: createSubscription,
      retrieve: retrieveSubscription,
      list: listSubscriptions,
      update: updateSubscription,
      cancel: cancelSubscription,
    },
    paymentMethods: { list: listMethods },
    paymentIntents: { create: createIntent, cancel: jest.fn() },
    billingPortal: { sessions: { create: createPortal } },
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

import { HttpException } from '@nestjs/common';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { trialEmailKey } from '@gitroom/nestjs-libraries/services/trial-identity';
import { TRIAL_DAYS } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// The free trial starts without a card (sign-ups stopped at the card form). One click on the plan
// screen creates a trialing subscription with no payment method; Stripe
// cancels it at the end unless a card was added. One trial per email.
const body = { billing: 'STANDARD', period: 'MONTHLY' } as any;
let n = 0;
let mail = '';

const build = (allowTrial = true) => {
  const organizationService = {
    getOrgById: jest.fn().mockResolvedValue({ id: 'org-1', paymentId: 'cus_new', allowTrial }),
    getOrgByCustomerId: jest.fn().mockResolvedValue({ id: 'org-1', allowTrial }),
    endTrialOffer: jest.fn().mockResolvedValue({}),
  };
  const userService = { getUserById: jest.fn().mockResolvedValue({ id: 'user-1', email: mail }) };
  const subscriptionService = {
    getSubscription: jest.fn().mockResolvedValue(null),
    createOrUpdateSubscription: jest.fn().mockResolvedValue({}),
  };
  const notificationService = { inAppNotification: jest.fn().mockResolvedValue(undefined) };
  const service = new StripeService(subscriptionService as any, organizationService as any, userService as any, {} as any, notificationService as any);
  jest.spyOn(service as any, 'createOrGetCustomer').mockResolvedValue('cus_new');
  jest.spyOn(service as any, 'listSubscriptions').mockResolvedValue([]);
  jest.spyOn(service as any, 'findOrCreateProduct').mockResolvedValue({ id: 'prod_1' });
  jest.spyOn(service as any, 'findAutoApplyPromotionCode').mockResolvedValue(null);
  return { service, organizationService, subscriptionService, notificationService };
};

beforeEach(() => {
  jest.clearAllMocks();
  // Each test its own address: the Redis reservation outlives a test.
  mail = `trial.start.${Date.now()}.${++n}@example.com`;
  listPrices.mockResolvedValue({ data: [{ id: 'price_1', currency: 'gbp', unit_amount: 1900, recurring: { interval: 'month' } }] });
  searchCustomers.mockResolvedValue({ data: [] });
  createSubscription.mockResolvedValue({ id: 'sub_new', status: 'trialing' });
});

describe('starting the trial', () => {
  it('creates a 5-day trialing subscription with no card, cancelled at the end without one', async () => {
    const { service } = build();

    const result = await service.startTrial('track', 'org-1', 'user-1', body, true);

    expect(TRIAL_DAYS).toBe(5);
    expect(createSession).not.toHaveBeenCalled();
    const [params] = createSubscription.mock.calls[0];
    expect(params.customer).toBe('cus_new');
    expect(params.items).toEqual([{ price: 'price_1', quantity: 1 }]);
    expect(params.trial_period_days).toBe(5);
    expect(params.trial_settings).toEqual({ end_behavior: { missing_payment_method: 'cancel' } });
    expect(params.payment_settings).toEqual({ save_default_payment_method: 'on_subscription' });
    expect(params).not.toHaveProperty('default_payment_method');
    expect(params.metadata).toEqual(
      expect.objectContaining({ service: 'gitroom', billing: 'STANDARD', period: 'MONTHLY', userId: 'user-1', ud: 'track', trial_no_card: '1' })
    );
    // The page waits on /billing/check/<id>, as after a checkout.
    expect(result).toEqual({ id: params.metadata.uniqueId });
    // The email is marked at once, not only when the webhook comes.
    expect(updateCustomer).toHaveBeenCalledWith('cus_new', { metadata: { trial_email: trialEmailKey(mail) } });
  });

  it('a second click while the first is starting gets no second trial', async () => {
    let release: (v: unknown) => void = () => undefined;
    createSubscription.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const { service } = build();
    const org = `org-lock-${Date.now()}`;

    const first = service.startTrial('track', org, 'user-1', body, true);
    await new Promise((r) => setTimeout(r, 50));
    await expect(service.startTrial('track', org, 'user-1', body, true)).rejects.toMatchObject({ status: 409 });
    release({ id: 'sub_new', status: 'trialing' });
    await first;

    expect(createSubscription).toHaveBeenCalledTimes(1);
  });

  it('mails the trial, its end and its limits, and how to keep the plan', async () => {
    process.env.FRONTEND_URL = 'https://app.example';
    // 1 December 2026, 15:00 UTC.
    createSubscription.mockResolvedValue({ id: 'sub_new', status: 'trialing', trial_end: Date.UTC(2026, 11, 1, 15) / 1000 });
    const { service, notificationService } = build();

    await service.startTrial('track', 'org-1', 'user-1', { billing: 'PRO', period: 'MONTHLY' } as any, true);

    expect(notificationService.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      'Your Postra free trial has started',
      'Your 5-day free trial of Postra Pro has started and ends on 1 December. It includes 2 channels, 15 posts, 10 AI images, 1 AI video and 50 questions to the AI assistant; your plan\'s full limits start with your first payment. To keep your plan after the trial, add a card in Billing: https://app.example/billing. Without a card, nothing is charged when the trial ends.',
      true,
      false,
      'info'
    );
  });

  // The subscription exists once Stripe made it: a failed write of the mark
  // on the customer is not an error for the customer (the webhook writes the
  // same mark, and Stripe retries it).
  it('a trial that started is answered as started, even when the email mark could not be written', async () => {
    updateCustomer.mockRejectedValueOnce(new Error('Stripe is slow'));
    const { service } = build();

    const result = await service.startTrial('track', 'org-1', 'user-1', body, true);

    expect(result.id).toBeTruthy();
    expect(createSubscription).toHaveBeenCalledTimes(1);
  });

  it('an email that already had a trial gets none, and the offer ends', async () => {
    searchCustomers.mockResolvedValue({ data: [{ id: 'cus_old' }] });
    const { service, organizationService } = build();

    await expect(service.startTrial('track', 'org-1', 'user-1', body, true)).rejects.toMatchObject({ status: 409 });

    expect(searchCustomers).toHaveBeenCalledWith(expect.objectContaining({ query: `metadata['trial_email']:'${trialEmailKey(mail)}'` }));
    expect(createSubscription).not.toHaveBeenCalled();
    expect(organizationService.endTrialOffer).toHaveBeenCalledWith('org-1');
  });

  it('an organisation whose offer ended gets no trial', async () => {
    const { service } = build(false);

    await expect(service.startTrial('track', 'org-1', 'user-1', body, false)).rejects.toBeInstanceOf(HttpException);

    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('an organisation that already has a subscription gets no second one', async () => {
    const { service } = build();
    (service as any).listSubscriptions.mockResolvedValue([{ id: 'sub_old', status: 'trialing' }]);

    await expect(service.startTrial('track', 'org-1', 'user-1', body, true)).rejects.toMatchObject({ status: 409 });

    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('a failed create gives the email back, so the trial can be started again', async () => {
    createSubscription.mockRejectedValueOnce(new Error('Stripe is down'));
    const { service } = build();

    await expect(service.startTrial('track', 'org-1', 'user-1', body, true)).rejects.toThrow('Stripe is down');
    createSubscription.mockResolvedValue({ id: 'sub_new', status: 'trialing' });
    await service.startTrial('track', 'org-1', 'user-1', body, true);

    expect(createSubscription).toHaveBeenCalledTimes(2);
  });
});

describe('the checkout pays at once', () => {
  it.each([
    ['embedded', (s: StripeService) => s.embedded('track', 'org-1', 'user-1', body)],
    ['hosted', (s: StripeService) => s.subscribe('track', 'org-1', 'user-1', body)],
  ])('%s checkout has no trial, even while the trial is offered', async (_name, checkout) => {
    const { service } = build();

    const result: any = await checkout(service);

    const params = createSession.mock.calls[0][0];
    expect(params.subscription_data.trial_period_days).toBeUndefined();
    expect(params.allowed_payment_method_types).toBeUndefined();
    if ('trial' in result) {
      expect(result.trial).toBe(false);
    }
  });
});

describe('the webhook of a trial without a card', () => {
  const trialing = {
    id: 'sub_new',
    customer: 'cus_new',
    status: 'trialing',
    cancel_at: null,
    created: 1,
    metadata: { billing: 'STANDARD', period: 'MONTHLY', uniqueId: 'u1', userId: 'user-1', trial_no_card: '1' },
  };
  const event = { id: 'evt_1', type: 'customer.subscription.created', data: { object: trialing } } as any;

  beforeEach(() => {
    retrieveSubscription.mockResolvedValue(trialing);
    listSubscriptions.mockResolvedValue({ data: [] });
    listMethods.mockResolvedValue({ data: [] });
  });

  it('starts the trial without a card fingerprint or a £1 card check, and marks the email', async () => {
    const { service, subscriptionService } = build();

    await service.createSubscription(event);

    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(createIntent).not.toHaveBeenCalled();
    expect(updateCustomer).toHaveBeenCalledWith('cus_new', { metadata: { trial_email: trialEmailKey(mail) } });
    expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalled();
    expect(subscriptionService.createOrUpdateSubscription.mock.calls[0][0]).toBe(true);
  });

  it('still cancels it when the email had a trial on another customer', async () => {
    searchCustomers.mockResolvedValue({ data: [{ id: 'cus_old' }] });
    const { service, subscriptionService } = build();

    const result = await service.createSubscription(event);

    expect(cancelSubscription).toHaveBeenCalledWith('sub_new');
    expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, skipped: 'trial email used before' });
  });

  it('a card trial from before still needs its card fingerprint', async () => {
    retrieveSubscription.mockResolvedValue({ ...trialing, metadata: { ...trialing.metadata, trial_no_card: undefined } });
    const { service, subscriptionService } = build();

    const result = await service.createSubscription(event);

    expect(result).toEqual({ ok: true, skipped: 'trial without a card fingerprint' });
    expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
  });
});

describe('ending the trial early', () => {
  it('without a card asks for one first: Stripe would cancel the trial instead of charging', async () => {
    listSubscriptions.mockResolvedValue({ data: [{ id: 'sub_new', status: 'trialing', default_payment_method: null }] });
    retrieveCustomer.mockResolvedValue({ id: 'cus_new', invoice_settings: { default_payment_method: null } });
    const { service } = build();

    expect(await service.finishTrial('cus_new')).toEqual({ finish: false, reason: 'no-card' });
    expect(updateSubscription).not.toHaveBeenCalled();
  });

  it('with a card on the customer charges it, as before', async () => {
    listSubscriptions.mockResolvedValue({ data: [{ id: 'sub_new', status: 'trialing', default_payment_method: null }] });
    retrieveCustomer.mockResolvedValue({ id: 'cus_new', invoice_settings: { default_payment_method: 'pm_1' } });
    updateSubscription.mockResolvedValueOnce({ status: 'active' });
    const { service } = build();

    expect(await service.finishTrial('cus_new')).toEqual({ finish: true });
    expect(updateSubscription).toHaveBeenCalledWith('sub_new', expect.objectContaining({ trial_end: 'now' }));
  });
});

// A card added in the trial keeps the plan: Stripe's portal opens straight on
// its "add a payment method" page, and the card becomes the customer's
// default for invoices, which the first charge after the trial uses.
describe('adding a card during the trial', () => {
  it('opens the portal on the payment method page, back to Billing after', async () => {
    process.env.FRONTEND_URL = 'https://app.example';
    const { service } = build();

    await service.createBillingPortalLink('cus_new', 'card');

    expect(createPortal).toHaveBeenCalledWith({
      customer: 'cus_new',
      return_url: 'https://app.example/billing',
      flow_data: {
        type: 'payment_method_update',
        after_completion: { type: 'redirect', redirect: { return_url: 'https://app.example/billing?card=added' } },
      },
    });
  });

  it('from "End the trial now", comes back to confirm the payment', async () => {
    process.env.FRONTEND_URL = 'https://app.example';
    const { service } = build();

    await service.createBillingPortalLink('cus_new', 'card-now');

    expect(createPortal.mock.calls[0][0].flow_data.after_completion.redirect.return_url).toBe(
      'https://app.example/billing?finishTrial=true'
    );
  });

  it('the plain portal link is unchanged', async () => {
    process.env.FRONTEND_URL = 'https://app.example';
    const { service } = build();

    await service.createBillingPortalLink('cus_new');

    expect(createPortal).toHaveBeenCalledWith({ customer: 'cus_new', return_url: 'https://app.example/billing' });
  });
});

// After a trial without a card ends, every page leads to the plan screen,
// which says the trial has ended instead of offering one.
describe('the plan screen after the trial', () => {
  it('knows a trial without a card ran to its end', async () => {
    const { service } = build(false);
    (service as any).listSubscriptions.mockResolvedValue([
      { id: 'sub_t', status: 'canceled', trial_end: 1000, canceled_at: 1000, metadata: { trial_no_card: '1' } },
    ]);

    expect((await service.embedded('track', 'org-1', 'user-1', body)).trialEnded).toBe(true);
  });

  it('a trial cancelled before its end, or none at all, is not "ended"', async () => {
    const { service } = build(false);
    (service as any).listSubscriptions.mockResolvedValue([
      { id: 'sub_t', status: 'canceled', trial_end: 1000, canceled_at: 500, metadata: { trial_no_card: '1' } },
    ]);
    expect((await service.embedded('track', 'org-1', 'user-1', body)).trialEnded).toBe(false);

    (service as any).listSubscriptions.mockResolvedValue([]);
    expect((await service.embedded('track', 'org-1', 'user-1', body)).trialEnded).toBe(false);
  });
});

// The trial bar says how many days are left and whether a card will keep the
// plan, from Stripe: the plan row does not hold the trial's end.
describe('the trial bar', () => {
  it('reads the end of the trial and whether there is a card', async () => {
    listSubscriptions.mockResolvedValue({ data: [{ id: 'sub_new', customer: 'cus_new', status: 'trialing', trial_end: 2000, default_payment_method: null }] });
    retrieveCustomer.mockResolvedValue({ id: 'cus_new', invoice_settings: { default_payment_method: null } });
    const { service } = build();

    expect(await service.trialStatus('cus_new')).toEqual({ endsAt: 2000 * 1000, hasCard: false });
  });

  it('no trial, no bar', async () => {
    listSubscriptions.mockResolvedValue({ data: [{ id: 'sub_new', status: 'active' }] });
    const { service } = build();

    expect(await service.trialStatus('cus_new')).toBeNull();
  });
});
