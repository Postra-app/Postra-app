import { expect, test } from '@playwright/test';
import { watchForErrors } from './ui-helpers';

// The billing history on /billing. The stack has no Stripe, so the invoices
// come from a route: what matters here is what the customer reads — our plan
// names, amounts in pounds, status, links — and that a £0 trial invoice is
// not listed.
const day = (d: string) => Math.floor(new Date(d).getTime() / 1000);

test('Billing lists the invoices with our plan names and links, without the £0 trial one', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.route('**/api/billing/invoices', (route) =>
    route.fulfill({
      json: [
        { id: 'in_a', number: 'P-1', tier: 'STANDARD', period: 'MONTHLY', description: null, amount: 1900, currency: 'gbp', created: day('2026-10-10'), periodEnd: day('2026-11-10'), status: 'paid', downloadUrl: 'https://pay.stripe.com/a.pdf', viewUrl: 'https://invoice.stripe.com/a' },
        { id: 'in_b', number: 'P-2', tier: 'ULTIMATE', period: 'YEARLY', description: null, amount: 79000, currency: 'gbp', created: day('2026-11-10'), periodEnd: day('2027-11-10'), status: 'failed', downloadUrl: null, viewUrl: 'https://invoice.stripe.com/b' },
        { id: 'in_c', number: 'P-0', tier: 'PRO', period: 'MONTHLY', description: null, amount: 0, currency: 'gbp', created: day('2026-10-03'), periodEnd: day('2026-10-10'), status: 'paid', downloadUrl: null, viewUrl: null },
      ],
    })
  );
  await page.goto('/billing');
  await expect(page.getByText('Billing History')).toBeVisible({ timeout: 20_000 });
  // Our plan names (Starter, Business), not Stripe's tier keys.
  await expect(page.getByText('Monthly · P-1').locator('..')).toContainText('Starter');
  await expect(page.getByText('Yearly · P-2').locator('..')).toContainText('Business');
  await expect(page.getByText('£19.00')).toBeVisible();
  await expect(page.getByText('£790.00')).toBeVisible();
  await expect(page.getByText('Yearly · P-2').locator('../..')).toContainText('Failed');
  await expect(page.getByText(/· P-0/)).toHaveCount(0);
  await expect(page.getByText('£0.00')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download invoice' }).first()).toHaveAttribute('href', 'https://pay.stripe.com/a.pdf');
  expect(problems).toEqual([]);
});
