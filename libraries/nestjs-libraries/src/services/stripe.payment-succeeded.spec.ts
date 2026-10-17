const retrieveSubscription = jest.fn();

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: { retrieve: retrieveSubscription },
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

// The Stripe account is shared with other businesses, and the controller lets
// every invoice.payment_succeeded through. An invoice of a subscription that
// is not Postra's has no userId, and getUserById(undefined) is a findFirst
// with no filter: it returned an arbitrary Postra user for the purchase event.
const invoice = (amount_paid: number) =>
  ({
    data: {
      object: {
        id: 'in_1',
        amount_paid,
        parent: { subscription_details: { subscription: 'sub_1' } },
      },
    },
  }) as any;

const build = () => {
  const userService = {
    getUserById: jest.fn().mockResolvedValue({ id: 'u1', ip: '1.2.3.4', agent: 'ua' }),
  };
  const trackService = { track: jest.fn() };
  const service = new StripeService({} as any, {} as any, userService as any, trackService as any, {} as any);
  return { service, userService, trackService };
};

beforeEach(() => jest.clearAllMocks());

it('leaves invoices of other businesses on the shared account alone', async () => {
  retrieveSubscription.mockResolvedValue({ id: 'sub_1', metadata: {} });
  const { service, userService, trackService } = build();

  await expect(service.paymentSucceeded(invoice(1900))).resolves.toEqual({ ok: true });

  expect(userService.getUserById).not.toHaveBeenCalled();
  expect(trackService.track).not.toHaveBeenCalled();
});

it('does not report the £0 invoice that starts a trial as a purchase', async () => {
  const { service, trackService } = build();

  await service.paymentSucceeded(invoice(0));

  expect(retrieveSubscription).not.toHaveBeenCalled();
  expect(trackService.track).not.toHaveBeenCalled();
});

it('reports a paid Postra invoice for the user who subscribed', async () => {
  retrieveSubscription.mockResolvedValue({
    id: 'sub_1',
    metadata: { service: 'gitroom', userId: 'u1', ud: 'ud1' },
  });
  const { service, userService, trackService } = build();

  await service.paymentSucceeded(invoice(1900));

  expect(userService.getUserById).toHaveBeenCalledWith('u1');
  expect(trackService.track).toHaveBeenCalledWith('ud1', '1.2.3.4', 'ua', expect.anything(), { value: 19 });
});
