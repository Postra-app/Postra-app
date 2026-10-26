const createSession = jest.fn().mockResolvedValue({ client_secret: 'cs_secret', url: 'https://checkout.example' });
const searchCustomers = jest.fn();
const listPrices = jest.fn();

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: createSession } },
    customers: { search: searchCustomers, update: jest.fn().mockResolvedValue({}) },
    prices: { list: listPrices, create: jest.fn() },
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
import { trialEmailKey } from '@gitroom/nestjs-libraries/services/trial-identity';

// 18 X: a test account got a second trial. Its checkout offered
// Link, which pays without a card fingerprint, so the one-trial-per-card check
// never ran, and nothing remembered the email of the first trial.
const body = { billing: 'STANDARD', period: 'MONTHLY' } as any;
const mail = 'trial.tester@example.com';

const build = () => {
  const organizationService = {
    getOrgById: jest.fn().mockResolvedValue({ id: 'org-1', paymentId: 'cus_new' }),
    endTrialOffer: jest.fn().mockResolvedValue({}),
  };
  const userService = { getUserById: jest.fn().mockResolvedValue({ id: 'user-1', email: mail }) };
  const subscriptionService = { getSubscription: jest.fn().mockResolvedValue(null) };
  const service = new StripeService(subscriptionService as any, organizationService as any, userService as any, {} as any, {} as any);
  jest.spyOn(service as any, 'createOrGetCustomer').mockResolvedValue('cus_new');
  jest.spyOn(service as any, 'listSubscriptions').mockResolvedValue([]);
  jest.spyOn(service as any, 'findOrCreateProduct').mockResolvedValue({ id: 'prod_1' });
  jest.spyOn(service as any, 'findAutoApplyPromotionCode').mockResolvedValue(null);
  return { service, organizationService };
};

beforeEach(() => {
  jest.clearAllMocks();
  listPrices.mockResolvedValue({ data: [{ id: 'price_1', currency: 'gbp', unit_amount: 1900, recurring: { interval: 'month' } }] });
});

describe.each([
  ['embedded', (s: StripeService, b = body) => s.embedded('track', 'org-1', 'user-1', b, true)],
  ['hosted', (s: StripeService, b = body) => s.subscribe('track', 'org-1', 'user-1', b, true)],
])('%s checkout', (_name, checkout) => {
  it('a trial checkout takes cards only', async () => {
    searchCustomers.mockResolvedValue({ data: [] });
    const { service, organizationService } = build();

    await checkout(service);

    const params = createSession.mock.calls[0][0];
    expect(params.payment_method_types).toEqual(['card']);
    expect(params.subscription_data.trial_period_days).toBe(7);
    expect(organizationService.endTrialOffer).not.toHaveBeenCalled();
  });

  it('an email that already had a trial checks out without one, with every payment method', async () => {
    searchCustomers.mockResolvedValue({ data: [{ id: 'cus_old' }] });
    const { service, organizationService } = build();

    await checkout(service);

    expect(searchCustomers).toHaveBeenCalledWith(expect.objectContaining({ query: `metadata['trial_email']:'${trialEmailKey(mail)}'` }));
    const params = createSession.mock.calls[0][0];
    expect(params.subscription_data.trial_period_days).toBeUndefined();
    expect(params.payment_method_types).toBeUndefined();
    expect(organizationService.endTrialOffer).toHaveBeenCalledWith('org-1');
  });

  // E2E-11-64: `utm` came from the request body into the return address as
  // it was, so `&check=` in it added a parameter of the caller's choosing.
  it('the utm value is one encoded parameter of the return address', async () => {
    searchCustomers.mockResolvedValue({ data: [] });
    process.env.FRONTEND_URL = 'https://app.example';
    const { service } = build();

    await checkout(service, { ...body, utm: 'mail&check=forged' });

    const params = createSession.mock.calls[0][0];
    const back = new URL(params.return_url ?? params.success_url);
    expect(back.searchParams.getAll('check')).toHaveLength(1);
    expect(back.searchParams.get('utm_source')).toBe('mail&check=forged');
  });
});

// 18 X (second test): the page still promised "Pay NOTHING for the first
// 7 days" from the organisation's offer, and the checkout charged £19 at once.
describe('what the billing pages promise', () => {
  it('the embedded checkout says whether it has free days', async () => {
    searchCustomers.mockResolvedValue({ data: [{ id: 'cus_old' }] });
    expect((await build().service.embedded('track', 'org-1', 'user-1', body, true)).trial).toBe(false);
    searchCustomers.mockResolvedValue({ data: [] });
    expect((await build().service.embedded('track', 'org-1', 'user-1', body, true)).trial).toBe(true);
  });

  it('an email that already had a trial is not offered one, and the offer ends', async () => {
    searchCustomers.mockResolvedValue({ data: [{ id: 'cus_old' }] });
    const { service, organizationService } = build();
    expect(await service.trialOffered(`org-a${Date.now()}`, 'cus_new', mail, true)).toBe(false);
    expect(organizationService.endTrialOffer).toHaveBeenCalled();
  });

  it('a new email keeps the offer, and the answer is cached', async () => {
    searchCustomers.mockResolvedValue({ data: [] });
    const { service, organizationService } = build();
    const org = `org-b${Date.now()}`;
    expect(await service.trialOffered(org, 'cus_new', 'someone.new@example.com', true)).toBe(true);
    expect(await service.trialOffered(org, 'cus_new', 'someone.new@example.com', true)).toBe(true);
    expect(searchCustomers).toHaveBeenCalledTimes(1);
    expect(organizationService.endTrialOffer).not.toHaveBeenCalled();
  });

  it('an organisation whose offer ended is not asked about', async () => {
    const { service } = build();
    expect(await service.trialOffered('org-c', 'cus_new', mail, false)).toBe(false);
    expect(searchCustomers).not.toHaveBeenCalled();
  });
});
