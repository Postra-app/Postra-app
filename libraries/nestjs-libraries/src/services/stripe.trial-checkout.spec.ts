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

// The checkout pays at once (the trial starts without one, see
// stripe.trial-start.spec.ts); what it still carries is the campaign, and the
// billing pages still ask whether the trial stands for this email.
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
  ['embedded', (s: StripeService, b = body) => s.embedded('track', 'org-1', 'user-1', b)],
  ['hosted', (s: StripeService, b = body) => s.subscribe('track', 'org-1', 'user-1', b)],
])('%s checkout', (_name, checkout) => {
  // `utm` in the return address and the subscription's metadata is the
  // campaign saved with the organisation at sign-up. It used to come from the
  // request body (and from the browser's storage before that), so a caller
  // chose it; whatever a request sends now is ignored.
  it('the return address carries the campaign the organisation signed up from', async () => {
    searchCustomers.mockResolvedValue({ data: [] });
    process.env.FRONTEND_URL = 'https://app.example';
    const { service, organizationService } = build();
    organizationService.getOrgById.mockResolvedValue({ id: 'org-1', paymentId: 'cus_new', signupSource: 'facebook' });

    await checkout(service, { ...body, utm: 'mail&check=forged' });

    const params = createSession.mock.calls[0][0];
    const back = new URL(params.return_url ?? params.success_url);
    expect(back.searchParams.getAll('check')).toHaveLength(1);
    expect(back.searchParams.get('utm_source')).toBe('facebook');
    expect(params.subscription_data.metadata.utm).toBe('facebook');
  });

  it('an organisation without a saved campaign checks out without one', async () => {
    searchCustomers.mockResolvedValue({ data: [] });
    process.env.FRONTEND_URL = 'https://app.example';
    const { service } = build();

    await checkout(service, { ...body, utm: 'newsletter' });

    const params = createSession.mock.calls[0][0];
    const back = new URL(params.return_url ?? params.success_url);
    expect(back.searchParams.has('utm_source')).toBe(false);
    expect(params.subscription_data.metadata).not.toHaveProperty('utm');
  });
});

// In a second test the page promised free days to an email that already
// had a trial.
describe('what the billing pages promise', () => {
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

// API 2026-10-28.endive renamed ui_mode 'custom' to 'elements' and rejects the
// old value, which the SDK types still accept as a plain string.
it('the embedded checkout opens in elements mode', async () => {
  searchCustomers.mockResolvedValue({ data: [] });
  createSession.mockClear();
  const { service } = build();

  await service.embedded('track', 'org-1', 'user-1', body);

  expect(createSession.mock.calls[0][0].ui_mode).toBe('elements');
});
