const listCharges = jest.fn();
const listInvoices = jest.fn();
const retrieveInvoice = jest.fn();

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const mock: any = jest.fn().mockImplementation(() => ({
    charges: { list: listCharges },
    invoices: { list: listInvoices, retrieve: retrieveInvoice },
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

// A charge no longer names its invoice on Stripe's API (removed with
// 2025-03-31.basil; checked on the Stripe sandbox 27 Nov 2026), so the invoice
// PDF in the admin's billing history was always empty. The invoice lists its
// payments, each with the PaymentIntent the charge carries.
const charge = (over: any = {}) => ({
  id: 'ch_1',
  amount: 2900,
  currency: 'gbp',
  created: 1,
  status: 'succeeded',
  refunded: false,
  amount_refunded: 0,
  description: 'Subscription creation',
  receipt_url: 'https://pay.stripe.com/receipts/x',
  payment_intent: 'pi_1',
  ...over,
});

const build = () => {
  const organizationService = { getOrgById: jest.fn().mockResolvedValue({ id: 'org-1', paymentId: 'cus_1' }) };
  return new StripeService({} as any, organizationService as any, {} as any, {} as any, {} as any);
};

beforeEach(() => jest.clearAllMocks());

describe("the admin's billing history", () => {
  it('finds the invoice PDF of a charge through the invoice payments, in one request', async () => {
    listCharges.mockResolvedValue({ data: [charge(), charge({ id: 'ch_2', payment_intent: { id: 'pi_2' } })] });
    listInvoices.mockResolvedValue({
      data: [
        { id: 'in_1', invoice_pdf: 'https://pay.stripe.com/invoice/1/pdf', payments: { data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_1' } }] } },
        { id: 'in_2', invoice_pdf: 'https://pay.stripe.com/invoice/2/pdf', payments: { data: [{ payment: { type: 'payment_intent', payment_intent: { id: 'pi_2' } } }] } },
      ],
    });

    const rows = await build().getCharges('org-1');

    expect(listInvoices).toHaveBeenCalledWith({ customer: 'cus_1', limit: 100, expand: ['data.payments'] });
    expect(retrieveInvoice).not.toHaveBeenCalled();
    expect(rows.map((r) => [r.id, r.invoice, r.invoice_pdf])).toEqual([
      ['ch_1', 'in_1', 'https://pay.stripe.com/invoice/1/pdf'],
      ['ch_2', 'in_2', 'https://pay.stripe.com/invoice/2/pdf'],
    ]);
    expect(rows[0]).not.toHaveProperty('payment_intent');
  });

  it('a charge of no invoice, or invoices Stripe would not list, keep the receipt', async () => {
    listCharges.mockResolvedValue({ data: [charge({ payment_intent: null })] });
    listInvoices.mockRejectedValue(new Error('rate limited'));

    const rows = await build().getCharges('org-1');

    expect(rows).toEqual([expect.objectContaining({ id: 'ch_1', invoice: null, invoice_pdf: null, receipt_url: 'https://pay.stripe.com/receipts/x' })]);
  });
});
