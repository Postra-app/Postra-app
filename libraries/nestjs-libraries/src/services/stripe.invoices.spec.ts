import { invoiceRows } from '@gitroom/nestjs-libraries/services/stripe.invoices';

const invoice = (over: any = {}) => ({
  id: 'in_1',
  number: 'POSTRA-0001',
  status: 'paid',
  attempted: true,
  total: 1900,
  currency: 'gbp',
  created: 1_790_000_000,
  period_end: 1_790_000_000,
  invoice_pdf: 'https://pay.stripe.com/invoice/x/pdf',
  hosted_invoice_url: 'https://invoice.stripe.com/i/x',
  parent: { subscription_details: { metadata: { billing: 'STANDARD', period: 'MONTHLY' } } },
  lines: { data: [{ description: '1 × Starter', period: { end: 1_792_600_000 } }] },
  ...over,
});

describe('billing history rows', () => {
  it('turns a Stripe invoice into a row: plan and period from the subscription, the period end of its lines, links', () => {
    expect(invoiceRows([invoice()] as any)).toEqual([
      {
        id: 'in_1',
        number: 'POSTRA-0001',
        tier: 'STANDARD',
        period: 'MONTHLY',
        description: '1 × Starter',
        amount: 1900,
        currency: 'gbp',
        created: 1_790_000_000,
        periodEnd: 1_792_600_000,
        status: 'paid',
        downloadUrl: 'https://pay.stripe.com/invoice/x/pdf',
        viewUrl: 'https://invoice.stripe.com/i/x',
      },
    ]);
  });

  it('says paid, pending, failed (an attempted open invoice) or void, and leaves drafts out', () => {
    const rows = invoiceRows([
      invoice({ id: 'a', status: 'open', attempted: false }),
      invoice({ id: 'b', status: 'open', attempted: true }),
      invoice({ id: 'c', status: 'uncollectible' }),
      invoice({ id: 'd', status: 'void' }),
      invoice({ id: 'e', status: 'draft' }),
    ] as any);
    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual(['a:pending', 'b:failed', 'c:failed', 'd:void']);
  });
});
