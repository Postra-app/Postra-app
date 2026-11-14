const listMethods = jest.fn();
const createIntent = jest.fn();
const cancelIntent = jest.fn();
const detachMethod = jest.fn();
const cancelSubscription = jest.fn();

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    paymentMethods: { list: listMethods, detach: detachMethod },
    paymentIntents: { create: createIntent, cancel: cancelIntent },
    subscriptions: { cancel: cancelSubscription },
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { StripeError } = (require('stripe') as any).errors;

// The £1 check before a first subscription detached the
// card and cancelled the subscription on any failure but 3-D Secure — a
// Stripe outage or rate limit included — and answered 200, so Stripe never
// retried.
describe('card check before a first subscription', () => {
  const service = new StripeService(
    {} as any,
    { getOrgByCustomerId: async () => ({ allowTrial: true }) } as any,
    {} as any,
    {} as any,
    {} as any
  );
  const event = { data: { object: { id: 'sub_1', customer: 'cus_1' } } } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    listMethods.mockResolvedValue({ data: [{ id: 'pm_1', created: 1 }] });
  });

  it('a Stripe outage is passed on for a retry, and the card and plan stay', async () => {
    createIntent.mockRejectedValueOnce(
      StripeError.generate({ type: 'api_error', message: 'Stripe is down', statusCode: 500 })
    );
    await expect((service as any).checkValidCard(event)).rejects.toThrow('Stripe is down');
    expect(detachMethod).not.toHaveBeenCalled();
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it('a declined card still ends the trial attempt', async () => {
    createIntent.mockRejectedValueOnce(
      StripeError.generate({ type: 'card_error', code: 'card_declined', message: 'declined', statusCode: 402 })
    );
    await expect((service as any).checkValidCard(event)).resolves.toBe(false);
    expect(detachMethod).toHaveBeenCalledWith('pm_1');
    expect(cancelSubscription).toHaveBeenCalledWith('sub_1');
  });

  // Upstream ecfd943ae: detach ran first and in the same try as the cancel.
  // A failed detach left a live Stripe subscription with no plan behind it:
  // silently after a decline, or as a 500 that Stripe retried with a new £1
  // hold after a refused hold.
  it('a refused hold cancels the subscription even when the detach fails', async () => {
    createIntent.mockResolvedValueOnce({ id: 'pi_1', status: 'requires_payment_method' });
    detachMethod.mockRejectedValueOnce(
      StripeError.generate({ type: 'invalid_request_error', message: 'No such PaymentMethod', statusCode: 404 })
    );
    await expect((service as any).checkValidCard(event)).resolves.toBe(false);
    expect(cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(cancelSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      detachMethod.mock.invocationCallOrder[0]
    );
  });

  it('a declined card cancels the subscription even when the detach fails', async () => {
    createIntent.mockRejectedValueOnce(
      StripeError.generate({ type: 'card_error', code: 'card_declined', message: 'declined', statusCode: 402 })
    );
    detachMethod.mockRejectedValueOnce(new Error('detach failed'));
    await expect((service as any).checkValidCard(event)).resolves.toBe(false);
    expect(cancelSubscription).toHaveBeenCalledWith('sub_1');
  });

  // Codex on the port: the cancel failing (a Stripe outage) must still fail
  // the webhook, so Stripe sends it again and the subscription gets
  // cancelled; the card is detached either way.
  it('a failed cancel fails the webhook for a retry, and the card is still detached', async () => {
    createIntent.mockResolvedValueOnce({ id: 'pi_1', status: 'requires_payment_method' });
    cancelSubscription.mockRejectedValueOnce(
      StripeError.generate({ type: 'api_error', message: 'Stripe is down', statusCode: 500 })
    );
    await expect((service as any).checkValidCard(event)).rejects.toThrow('Stripe is down');
    expect(detachMethod).toHaveBeenCalledWith('pm_1');
  });
});
