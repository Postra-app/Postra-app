const listSubscriptions = jest.fn();
const listInvoices = jest.fn();
const voidInvoice = jest.fn();

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    subscriptions: { list: listSubscriptions },
    invoices: { list: listInvoices, voidInvoice },
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

// An unpaid invoice of a cancelled subscription stayed payable on Stripe's
// invoice page: a customer could pay for a period they no longer get
// (upstream 79a3edcc3). The Stripe account is shared with other businesses,
// so only our own subscriptions' invoices are touched.
describe('unpaid invoices of cancelled subscriptions', () => {
  const subscriptions = { deleteSubscription: jest.fn() };
  const service = new StripeService(subscriptions as any, {} as any, {} as any, {} as any, {} as any);
  const invoice = (id: string, sub: string) => ({
    id,
    parent: { subscription_details: { subscription: sub } },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    listInvoices.mockImplementation(async ({ status }: { status: string }) => ({
      data:
        status === 'open'
          ? [invoice('in_ours', 'sub_old'), invoice('in_theirs', 'sub_other'), invoice('in_live', 'sub_live')]
          : [invoice('in_bad_debt', 'sub_old')],
    }));
  });

  it('are voided when the subscription ends, ours only', async () => {
    listSubscriptions.mockImplementation(async ({ status }: { status: string }) => ({
      data:
        status === 'canceled'
          ? [
              { id: 'sub_old', status: 'canceled', metadata: { service: 'gitroom' } },
              { id: 'sub_other', status: 'canceled', metadata: {} },
            ]
          : [],
    }));
    await service.deleteSubscription({
      data: { object: { id: 'sub_old', customer: 'cus_1', metadata: {} } },
    } as any);
    expect(voidInvoice.mock.calls.map((c) => c[0]).sort()).toEqual(['in_bad_debt', 'in_ours']);
  });

  it('a failure on one invoice does not stop the others, nor the webhook', async () => {
    listSubscriptions.mockImplementation(async ({ status }: { status: string }) => ({
      data: status === 'canceled' ? [{ id: 'sub_old', status: 'canceled', metadata: { service: 'gitroom' } }] : [],
    }));
    voidInvoice.mockRejectedValueOnce(new Error('Stripe is down'));
    await expect(service.voidUnpaidInvoices('cus_1')).resolves.toBeUndefined();
    expect(voidInvoice).toHaveBeenCalledTimes(2);
  });
});
