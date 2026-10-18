const retrieveSubscription = jest.fn();
const listSubscriptions = jest.fn();
const cancelSubscription = jest.fn().mockResolvedValue({});
const updateSubscription = jest.fn().mockResolvedValue({});
const listMethods = jest.fn();
const searchCustomers = jest.fn();
const updateCustomer = jest.fn().mockResolvedValue({});
const createIntent = jest.fn();
const cancelIntent = jest.fn().mockResolvedValue({});

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: { retrieve: retrieveSubscription, list: listSubscriptions, cancel: cancelSubscription, update: updateSubscription },
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
import { trialEmailKey } from '@gitroom/nestjs-libraries/services/trial-identity';

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

const build = (allowTrial = true, email: string | null = null) => {
  const userService = { getUserById: jest.fn().mockResolvedValue(email ? { id: 'user-2', email } : null) };
  const subscriptionService = { createOrUpdateSubscription: jest.fn().mockResolvedValue({}) };
  const organizationService = {
    getOrgByCustomerId: jest.fn().mockResolvedValue({ id: 'org-2', allowTrial }),
    endTrialOffer: jest.fn().mockResolvedValue({}),
  };
  const notificationService = { inAppNotification: jest.fn().mockResolvedValue(undefined) };
  const service = new StripeService(subscriptionService as any, organizationService as any, userService as any, {} as any, notificationService as any);
  return { service, subscriptionService, organizationService, notificationService };
};

let fingerprint = '';
let n = 0;
const card = (fp: string) => ({ data: [{ id: 'pm_1', created: 10, card: { fingerprint: fp } }] });

beforeEach(() => {
  jest.clearAllMocks();
  // Each test its own card: the Redis reservation outlives a test.
  fingerprint = `Fp${Date.now()}x${++n}`;
  retrieveSubscription.mockResolvedValue(trialing);
  listSubscriptions.mockResolvedValue({ data: [] });
  listMethods.mockResolvedValue(card(fingerprint));
  // The £1 card check passes.
  createIntent.mockResolvedValue({ id: 'pi_1', status: 'requires_capture' });
});

it('cancels a trial on a card that already had one, before any charge', async () => {
  searchCustomers.mockResolvedValue({ data: [{ id: 'cus_1' }] });
  const { service, subscriptionService, organizationService, notificationService } = build();

  const result = await service.createSubscription(event);

  expect(searchCustomers).toHaveBeenCalledWith(expect.objectContaining({ query: `metadata['trial_card']:'${fingerprint}'` }));
  // Marked before the cancel, so a retry can finish a rejection cut short.
  expect(updateSubscription).toHaveBeenCalledWith('sub_2', { metadata: { trial_rejected: 'card' } });
  expect(updateSubscription.mock.invocationCallOrder[0]).toBeLessThan(cancelSubscription.mock.invocationCallOrder[0]);
  expect(cancelSubscription).toHaveBeenCalledWith('sub_2');
  expect(createIntent).not.toHaveBeenCalled();
  expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
  expect(organizationService.endTrialOffer).toHaveBeenCalledWith('org-2');
  // The offer ends before the cancel: the page reloads its checkout when it
  // sees the cancel, and must not get a trial checkout again (18 X).
  expect(organizationService.endTrialOffer.mock.invocationCallOrder[0]).toBeLessThan(
    cancelSubscription.mock.invocationCallOrder[0]
  );
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
  expect(updateCustomer).toHaveBeenCalledWith('cus_2', { metadata: { trial_card: fingerprint } });
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

it('leaves paid subscriptions and trials already checked alone', async () => {
  retrieveSubscription.mockResolvedValue({ ...trialing, metadata: { ...trialing.metadata, trial_checked: '1' } });
  await build().service.createSubscription(event);
  retrieveSubscription.mockResolvedValue({ ...trialing, status: 'active' });
  await build().service.createSubscription(event);

  expect(searchCustomers).not.toHaveBeenCalled();
  expect(cancelSubscription).not.toHaveBeenCalled();
});

it('a checked trial is marked on its subscription, so later events skip the check', async () => {
  searchCustomers.mockResolvedValue({ data: [] });
  await build().service.createSubscription(event);
  expect(updateSubscription).toHaveBeenCalledWith('sub_2', { metadata: { trial_checked: '1' } });
});

// Codex 10-18: a checkout opened while the offer stood keeps its trial after
// the offer ends (another organisation's trial, then the email check at the
// next checkout). The offer used to skip the webhook check, so that trial ran.
it('checks a trial although the organisation\u2019s offer has ended since its checkout opened', async () => {
  searchCustomers.mockResolvedValue({ data: [{ id: 'cus_1' }] });
  const { service, subscriptionService } = build(false);

  const result = await service.createSubscription(event);

  expect(cancelSubscription).toHaveBeenCalledWith('sub_2');
  expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
  expect(result).toEqual({ ok: true, skipped: 'trial card used before' });
});

// Codex 10-17: Stripe's search index lags (~20 s on the sandbox), so two
// trials started at once on one card both found nothing.
it('two trials at once on one card: the second is cancelled although search finds nothing yet', async () => {
  searchCustomers.mockResolvedValue({ data: [] });
  await build().service.createSubscription(event);
  expect(cancelSubscription).not.toHaveBeenCalled();

  const other = { ...trialing, id: 'sub_3', customer: 'cus_3' };
  retrieveSubscription.mockResolvedValue(other);
  await build().service.createSubscription({ ...event, data: { object: other } });
  expect(cancelSubscription).toHaveBeenCalledWith('sub_3');
});

it('a declined card gives its reservation back', async () => {
  searchCustomers.mockResolvedValue({ data: [] });
  createIntent.mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method' });
  await build().service.createSubscription(event);

  createIntent.mockResolvedValue({ id: 'pi_2', status: 'requires_capture' });
  const other = { ...trialing, id: 'sub_3', customer: 'cus_3' };
  retrieveSubscription.mockResolvedValue(other);
  const { service, subscriptionService } = build();
  await service.createSubscription({ ...event, data: { object: other } });
  expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalled();
});

// Codex 10-17: cancelled in Stripe, then a failure before the offer was taken
// away; the retry stopped at "cancelled" and the next checkout offered a trial.
it('a retry finishes a rejection cut short after the cancel', async () => {
  retrieveSubscription.mockResolvedValue({ ...trialing, status: 'canceled', metadata: { ...trialing.metadata, trial_rejected: 'card' } });
  const { service, organizationService, notificationService, subscriptionService } = build(true);

  await service.updateSubscription(event);

  expect(cancelSubscription).not.toHaveBeenCalled();
  expect(notificationService.inAppNotification).toHaveBeenCalled();
  expect(organizationService.endTrialOffer).toHaveBeenCalledWith('org-2');
  expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
});

it('and does nothing more once the rejection is complete', async () => {
  retrieveSubscription.mockResolvedValue({ ...trialing, status: 'canceled', metadata: { ...trialing.metadata, trial_rejected: 'card' } });
  const { service, organizationService, notificationService } = build(false);

  await service.updateSubscription(event);

  expect(notificationService.inAppNotification).not.toHaveBeenCalled();
  expect(organizationService.endTrialOffer).not.toHaveBeenCalled();
});

// K. 2026-10-18: one trial per email as well. A test account got
// a second trial: its first one ran through Link, which has no card
// fingerprint, and an account deleted from Postra leaves only its Stripe
// customer behind.
describe('one trial per email', () => {
  const withUser = { ...trialing, metadata: { ...trialing.metadata, userId: 'user-2' } };
  let mail = '';
  beforeEach(() => {
    mail = `tester${Date.now()}x${n}@example.com`;
    retrieveSubscription.mockResolvedValue(withUser);
  });

  it('cancels a trial whose email already had one, even on a new card', async () => {
    const key = trialEmailKey(mail);
    searchCustomers.mockImplementation(async ({ query }: { query: string }) =>
      query.includes('trial_email') ? { data: [{ id: 'cus_old' }] } : { data: [] }
    );
    const { service, subscriptionService, organizationService, notificationService } = build(true, mail);

    const result = await service.createSubscription({ ...event, data: { object: withUser } });

    expect(searchCustomers).toHaveBeenCalledWith(expect.objectContaining({ query: `metadata['trial_email']:'${key}'` }));
    expect(updateSubscription).toHaveBeenCalledWith('sub_2', { metadata: { trial_rejected: 'email' } });
    expect(cancelSubscription).toHaveBeenCalledWith('sub_2');
    expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
    expect(organizationService.endTrialOffer).toHaveBeenCalledWith('org-2');
    expect(notificationService.inAppNotification.mock.calls[0][2]).toBe(
      'This email address has already been used for a Postra trial. Choose a plan to subscribe without a trial.'
    );
    expect(result).toEqual({ ok: true, skipped: 'trial email used before' });
  });

  it('marks the card and the email of a first trial', async () => {
    searchCustomers.mockResolvedValue({ data: [] });
    const { service } = build(true, mail);

    await service.createSubscription({ ...event, data: { object: withUser } });

    expect(updateCustomer).toHaveBeenCalledWith('cus_2', {
      metadata: { trial_card: fingerprint, trial_email: trialEmailKey(mail) },
    });
  });

  it('a Link payment (no card fingerprint) is still caught by the email', async () => {
    listMethods.mockResolvedValue({ data: [{ id: 'pm_link', created: 10, type: 'link' }] });
    searchCustomers.mockResolvedValue({ data: [{ id: 'cus_old' }] });
    const { service } = build(true, mail);

    const result = await service.createSubscription({ ...event, data: { object: withUser } });

    expect(cancelSubscription).toHaveBeenCalledWith('sub_2');
    expect(result).toEqual({ ok: true, skipped: 'trial email used before' });
  });

  // K. 18 X: a card without a fingerprint cannot be marked, so a new email
  // would start another trial on it. No fingerprint, no trial.
  it('a trial without a card fingerprint is cancelled before any charge, even for a new email', async () => {
    listMethods.mockResolvedValue({ data: [{ id: 'pm_link', created: 10, type: 'link' }] });
    searchCustomers.mockResolvedValue({ data: [] });
    const { service, subscriptionService, organizationService, notificationService } = build(true, `new-${n}@example.com`);

    const result = await service.createSubscription({ ...event, data: { object: withUser } });

    expect(updateSubscription).toHaveBeenCalledWith('sub_2', { metadata: { trial_rejected: 'no_card' } });
    expect(cancelSubscription).toHaveBeenCalledWith('sub_2');
    expect(createIntent).not.toHaveBeenCalled();
    expect(updateCustomer).not.toHaveBeenCalled();
    expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
    expect(organizationService.endTrialOffer).toHaveBeenCalledWith('org-2');
    expect(notificationService.inAppNotification.mock.calls[0][2]).toBe(
      'We could not confirm this card for a free trial, so nothing was charged. Choose a plan to subscribe without a trial.'
    );
    expect(result).toEqual({ ok: true, skipped: 'trial without a card fingerprint' });
  });

  it('a retry finishes an email rejection cut short', async () => {
    retrieveSubscription.mockResolvedValue({ ...withUser, status: 'canceled', metadata: { ...withUser.metadata, trial_rejected: 'email' } });
    const { service, organizationService } = build(true, mail);

    await service.updateSubscription(event);

    expect(organizationService.endTrialOffer).toHaveBeenCalledWith('org-2');
  });
});

describe('trialEmailKey', () => {
  it('is the same for every spelling of one inbox', () => {
    const key = trialEmailKey('trial.tester@example.com');
    expect(trialEmailKey(' Trial.Tester+2@Example.com ')).toBe(key);
    expect(trialEmailKey('j.doe@gmail.com')).toBe(trialEmailKey('jdoe+trial@googlemail.com'));
    expect(trialEmailKey('j.doe@yahoo.com')).not.toBe(trialEmailKey('jdoe@yahoo.com'));
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(trialEmailKey('')).toBeNull();
    expect(trialEmailKey('nobody')).toBeNull();
  });
});
