const listSubscriptions = jest.fn();
const updateSubscription = jest.fn();

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: { list: listSubscriptions, update: updateSubscription },
  }));
  mock.errors = actual.errors ?? actual.default?.errors;
  return mock;
});
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({ TrackService: class {} }));

import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';

// POST /billing/cancel toggled: a second "cancel" from a stale tab or a second
// admin re-activated the subscription and it renewed; a stale "re-activate"
// cancelled it (upstream #2428). The request now says what it wants.
describe('setToCancel with an intent', () => {
  const subscriptions = { setCancelAt: jest.fn() };
  const organizations = { getOrgById: jest.fn().mockResolvedValue({ id: 'org-1' }) };
  const service = new StripeService(subscriptions as any, organizations as any, {} as any, {} as any, {} as any);
  const live = (cancelling: boolean) => ({
    id: 'sub_1',
    status: 'active',
    cancel_at_period_end: cancelling,
    cancel_at: cancelling ? 1_800_000_000 : null,
    latest_invoice: { status: 'paid' },
    metadata: { service: 'gitroom' },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service, 'createOrGetCustomer').mockResolvedValue('cus_1');
    jest.spyOn(service as any, 'releaseSchedule').mockResolvedValue(undefined);
    updateSubscription.mockImplementation(async (_id: string, body: { cancel_at_period_end: boolean }) => ({
      cancel_at: body.cancel_at_period_end ? 1_800_000_000 : null,
    }));
  });

  it('a second cancel leaves the cancellation in place', async () => {
    listSubscriptions.mockResolvedValue({ data: [live(true)] });
    const result = await service.setToCancel('org-1', true);
    expect(updateSubscription).not.toHaveBeenCalled();
    expect(subscriptions.setCancelAt).not.toHaveBeenCalled();
    expect(result).toMatchObject({ unchanged: true, cancel_at: new Date(1_800_000_000 * 1000) });
  });

  it('a stale re-activate does not cancel an active subscription', async () => {
    listSubscriptions.mockResolvedValue({ data: [live(false)] });
    const result = await service.setToCancel('org-1', false);
    expect(updateSubscription).not.toHaveBeenCalled();
    expect(result).toMatchObject({ unchanged: true, cancel_at: undefined });
  });

  it('cancel and re-activate still do their job', async () => {
    listSubscriptions.mockResolvedValue({ data: [live(false)] });
    expect((await service.setToCancel('org-1', true)).cancel_at).toEqual(new Date(1_800_000_000 * 1000));
    expect(updateSubscription).toHaveBeenLastCalledWith('sub_1', expect.objectContaining({ cancel_at_period_end: true }));

    listSubscriptions.mockResolvedValue({ data: [live(true)] });
    expect((await service.setToCancel('org-1', false)).cancel_at).toBeUndefined();
    expect(updateSubscription).toHaveBeenLastCalledWith('sub_1', expect.objectContaining({ cancel_at_period_end: false }));
  });

  it('a page loaded before the change (no intent) toggles as before', async () => {
    listSubscriptions.mockResolvedValue({ data: [live(true)] });
    await service.setToCancel('org-1');
    expect(updateSubscription).toHaveBeenCalledWith('sub_1', expect.objectContaining({ cancel_at_period_end: false }));
  });

  // Two live subscriptions, one already set to cancel (a duplicate, or a
  // cancel that failed half-way): "unchanged" left the other one charging.
  it('a cancel with one subscription still renewing cancels every one', async () => {
    listSubscriptions.mockResolvedValue({ data: [live(true), { ...live(false), id: 'sub_2' }] });
    const result = await service.setToCancel('org-1', true);
    expect(result).not.toHaveProperty('unchanged');
    expect(updateSubscription.mock.calls.map((c) => [c[0], c[1].cancel_at_period_end])).toEqual([
      ['sub_1', true],
      ['sub_2', true],
    ]);
  });

  it('a re-activate with one subscription still set to cancel re-activates every one', async () => {
    listSubscriptions.mockResolvedValue({ data: [live(false), { ...live(true), id: 'sub_2' }] });
    const result = await service.setToCancel('org-1', false);
    expect(result).not.toHaveProperty('unchanged');
    expect(updateSubscription.mock.calls.map((c) => [c[0], c[1].cancel_at_period_end])).toEqual([
      ['sub_1', false],
      ['sub_2', false],
    ]);
  });
});
