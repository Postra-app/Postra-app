import type Stripe from 'stripe';

// One row of the billing history (ported from upstream 3bd88cee9 + 8f3c38ab1,
// where it sits behind a payment-provider layer Postra does not have).
export interface PaymentInvoice {
  id: string;
  number: string | null;
  // pricing key and MONTHLY / YEARLY the invoice was for, when Stripe has it
  tier: string | null;
  period: string | null;
  description: string | null;
  // minor units (pence)
  amount: number;
  currency: string;
  // unix seconds
  created: number;
  periodEnd: number;
  status: 'paid' | 'pending' | 'failed' | 'void';
  downloadUrl: string | null;
  viewUrl: string | null;
}

export const invoiceRows = (invoices: Stripe.Invoice[]): PaymentInvoice[] =>
  invoices
    .filter((invoice) => invoice.status !== 'draft')
    .map((invoice) => {
      // the subscription's metadata ({ billing, period }) when the invoice was finalised
      const metadata = invoice.parent?.subscription_details?.metadata;
      return {
        id: invoice.id!,
        number: invoice.number,
        tier: metadata?.billing || null,
        period: metadata?.period || null,
        description: invoice.lines.data[0]?.description || null,
        amount: invoice.total,
        currency: invoice.currency,
        created: invoice.created,
        periodEnd: Math.max(
          invoice.period_end,
          ...invoice.lines.data.map((line) => line.period.end)
        ),
        // an open invoice that was already attempted is a failed charge waiting for a retry
        status:
          invoice.status === 'paid'
            ? 'paid'
            : invoice.status === 'void'
            ? 'void'
            : invoice.status === 'uncollectible' || invoice.attempted
            ? 'failed'
            : 'pending',
        downloadUrl: invoice.invoice_pdf || null,
        viewUrl: invoice.hosted_invoice_url || null,
      };
    });
