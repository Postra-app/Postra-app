const retrieveSubscription = jest.fn();
const listSubscriptions = jest.fn();
const cancelSubscription = jest.fn().mockResolvedValue({});
const listMethods = jest.fn();
const searchCustomers = jest.fn();
const updateCustomer = jest.fn().mockResolvedValue({});
const createIntent = jest.fn();
const cancelIntent = jest.fn().mockResolvedValue({});

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: { retrieve: retrieveSubscription, list: listSubscriptions, cancel: cancelSubscription },
    paymentMethods: { list: listMethods, detach: jest.fn() },
    paymentIntents: { create: createIntent, cancel: cancelIntent },
    customers: { search: searchCustomers, update: updateCustomer },
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

// K. 2026-10-16: one free trial per card. A new organisation meant a new
// trial, so one card could run trials for ever. A card that already had a
// trial cancels the new one before anything is charged (nothing is captured
// in a trial), the next checkout comes without a trial, and the customer is
// told why.
const trialing = {
  id: 'sub_2',
  customer: 'cus_2',
  status: 'trialing',
  cancel_at: null,
  created: 1,
  metadata: { billing: 'PRO', period: 'MONTHLY', uniqueId: 'u2' },
};
const event = { id: 'evt_1', type: 'customer.subscription.created', data: { object: trialing } } as any;

const build = (allowTrial = true) => {
  const subscriptionService = { createOrUpdateSubscription: jest.fn().mockResolvedValue({}) };
  const organizationService = {
    getOrgByCustomerId: jest.fn().mockResolvedValue({ id: 'org-2', allowTrial }),
    endTrialOffer: jest.fn().mockResolvedValue({}),
  };
  const notificationService = { inAppNotification: jest.fn().mockResolvedValue(undefined) };
  const service = new StripeService(subscriptionService as any, organizationService as any, {} as any, {} as any, notificationService as any);
  return { service, subscriptionService, organizationService, notificationService };
};

beforeEach(() => {
  jest.clearAllMocks();
  retrieveSubscription.mockResolvedValue(trialing);
  listSubscriptions.mockResolvedValue({ data: [] });
  listMethods.mockResolvedValue({ data: [{ id: 'pm_1', created: 10, card: { fingerprint: 'Fp1234abcd' } }] });
  // The £1 card check passes.
  createIntent.mockResolvedValue({ id: 'pi_1', status: 'requires_capture' });
});

it('cancels a trial on a card that already had one, before any charge', async () => {
  searchCustomers.mockResolvedValue({ data: [{ id: 'cus_1' }] });
  const { service, subscriptionService, organizationService, notificationService } = build();

  const result = await service.createSubscription(event);

  expect(searchCustomers).toHaveBeenCalledWith(expect.objectContaining({ query: "metadata['trial_card']:'Fp1234abcd'" }));
  expect(cancelSubscription).toHaveBeenCalledWith('sub_2');
  expect(createIntent).not.toHaveBeenCalled();
  expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
  expect(organizationService.endTrialOffer).toHaveBeenCalledWith('org-2');
  expect(notificationService.inAppNotification.mock.calls[0][2]).toBe(
    'This card has already been used for a Postra trial. Choose a plan to subscribe without a trial.'
  );
  expect(result).toEqual({ ok: true, skipped: 'trial card used before' });
});

it('starts the first trial on a card and marks the card on the customer', async () => {
  searchCustomers.mockResolvedValue({ data: [] });
  const { service, subscriptionService } = build();

  await service.createSubscription(event);

  expect(cancelSubscription).not.toHaveBeenCalled();
  expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalled();
  expect(updateCustomer).toHaveBeenCalledWith('cus_2', { metadata: { trial_card: 'Fp1234abcd' } });
});

it('does not count the customer’s own mark (later events of the same trial)', async () => {
  searchCustomers.mockResolvedValue({ data: [{ id: 'cus_2' }] });
  const { service, subscriptionService } = build();

  await service.createSubscription(event);

  expect(cancelSubscription).not.toHaveBeenCalled();
  expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalled();
});

it('does not mark a card that failed the £1 check', async () => {
  searchCustomers.mockResolvedValue({ data: [] });
  createIntent.mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method' });
  const { service } = build();

  await service.createSubscription(event);

  expect(updateCustomer).not.toHaveBeenCalled();
});

it('leaves paid subscriptions and organisations past their trial alone', async () => {
  const { service } = build(false);
  await service.createSubscription(event);
  retrieveSubscription.mockResolvedValue({ ...trialing, status: 'active' });
  await build().service.createSubscription(event);

  expect(searchCustomers).not.toHaveBeenCalled();
  expect(cancelSubscription).not.toHaveBeenCalled();
});
