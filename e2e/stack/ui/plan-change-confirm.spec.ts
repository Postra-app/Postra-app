import { expect, test } from '@playwright/test';

// E2E-07-43 (Kris Company, 2026-10-09): "Purchase plan" on a paying account
// charged at once — no window, and the amount next to the button was the one
// quoted when the page loaded (£50.00 shown, £49.68 charged). The change now
// asks first, with a fresh quote. The stack has no Stripe: routes answer.
test('changing plan asks first, with a fresh amount and the renewal', async ({ page }) => {
  const subscribe: string[] = [];
  // The page quotes when it loads; the click must ask again (the price has
  // moved by then).
  let clicked = false;
  await page.route('**/api/billing/prorate', (route) =>
    route.fulfill({ json: { price: clicked ? 49.68 : 50, renewsOn: '2026-11-09T09:35:51.000Z', renewalPrice: 79 } })
  );
  await page.route('**/api/billing/subscribe', (route) => {
    subscribe.push(route.request().method());
    return route.fulfill({ json: {} });
  });
  await page.goto('/billing');
  // Organisation A is on Pro: Business is an upgrade.
  await expect(page.getByText('(Pay Today £50.00)').last()).toBeVisible({ timeout: 20_000 });
  clicked = true;
  await page.getByRole('button', { name: /Purchase plan/ }).last().click();
  await expect(page.getByText(/Upgrade to Business now\? Today: £49\.68 for the rest of this billing month \(what is left of Pro is taken off\)\. From 9 November: £79 a month\./)).toBeVisible();
  expect(subscribe).toEqual([]);

  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
  expect(subscribe).toEqual([]);

  await page.getByRole('button', { name: /Purchase plan/ }).last().click();
  await page.getByRole('button', { name: 'Upgrade and pay £49.68' }).click();
  await expect.poll(() => subscribe).toEqual(['POST']);
});

// E2E-07-44 (Kris Company, 2026-10-09): Business → Starter changed at once and
// the unused Business went to the Stripe balance. A lower plan now starts at
// the renewal, as the subscription terms say, and Billing shows when.
test('a lower plan waits for the renewal, and Billing says when', async ({ page }) => {
  const on = '2026-11-09T09:35:51.000Z';
  const subscribe: string[] = [];
  let scheduled = false;
  await page.route('**/api/billing/prorate', (route) =>
    route.fulfill({ json: { price: 0, renewsOn: on, renewalPrice: 19, scheduled: true } })
  );
  await page.route('**/api/billing/subscribe', (route) => {
    subscribe.push(route.request().method());
    scheduled = true;
    return route.fulfill({ json: { id: 'x', scheduled: { billing: 'STANDARD', period: 'MONTHLY', on } } });
  });
  await page.route('**/api/billing/pending-change', (route) =>
    route.fulfill({ json: scheduled ? { billing: 'STANDARD', period: 'MONTHLY', on } : {} })
  );
  await page.goto('/billing');
  // Organisation A is on Pro with two people: Starter is lower, with one seat.
  await page.getByRole('button', { name: /Purchase plan/ }).first().click();
  await page.getByRole('button', { name: 'Yes, continue' }).click();
  await expect(
    page.getByText('Change to Starter on 9 November? You keep Pro until then. From 9 November: £19 a month.')
  ).toBeVisible();
  expect(subscribe).toEqual([]);
  await page.getByRole('button', { name: 'Change on 9 November' }).click();
  await expect.poll(() => subscribe).toEqual(['POST']);
  await expect(page.getByText('Changes to Starter on 9 November')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Current plan' })).toHaveCount(1);
});

// Codex on the 10-09 branch: when the quote failed, the window offered the
// change as free ("Nothing to pay today") and went on to charge. No quote, no
// window and no change.
test('without a quote from Stripe nothing is offered or changed', async ({ page }) => {
  const subscribe: string[] = [];
  await page.goto('/billing');
  await expect(page.getByRole('button', { name: /Purchase plan/ }).last()).toBeVisible();
  await page.route('**/api/billing/prorate', (route) => route.fulfill({ status: 500, json: {} }));
  await page.route('**/api/billing/subscribe', (route) => {
    subscribe.push(route.request().method());
    return route.fulfill({ json: {} });
  });
  await page.getByRole('button', { name: /Purchase plan/ }).last().click();
  await expect(page.getByText('Something went wrong, please try again.').first()).toBeVisible();
  await expect(page.getByText('Change your plan')).toHaveCount(0);
  expect(subscribe).toEqual([]);
});
