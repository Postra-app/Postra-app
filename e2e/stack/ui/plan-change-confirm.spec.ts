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
