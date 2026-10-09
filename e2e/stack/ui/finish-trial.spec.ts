import { expect, test } from '@playwright/test';

// E2E-07-41 / 07-42 (Kris Company, 2026-10-09): opening /billing?finishTrial=true
// ended the trial and charged the card at once — no price, no question — and
// a reload after the payment said "We could not take the first payment yet".
// The stack has no Stripe: the billing routes are answered here.
const routes = async (
  page: import('@playwright/test').Page,
  answer: object,
  preview: object = { amount: 2900, currency: 'gbp', tier: 'PRO', period: 'MONTHLY' }
) => {
  const calls: string[] = [];
  // What Stripe would charge for this subscription right now (Codex: the
  // price list is wrong for an older price or a discount).
  await page.route('**/api/billing/finish-trial/preview', (route) => route.fulfill({ json: preview }));
  await page.route('**/api/billing/prorate', (route) => route.fulfill({ json: { price: 0 } }));
  await page.route('**/api/user/subscription', (route) =>
    route.fulfill({ json: { subscription: { subscriptionTier: 'PRO', period: 'MONTHLY', totalChannels: 6, isLifetime: false } } })
  );
  await page.route('**/api/billing/finish-trial', (route) => {
    calls.push(route.request().method());
    return route.fulfill({ json: answer });
  });
  await page.route('**/api/billing/is-trial-finished', (route) => route.fulfill({ json: { finished: true } }));
  return calls;
};

test('ending the trial asks first, with the price, and only then charges', async ({ page }) => {
  const calls = await routes(page, { finish: true });
  await page.goto('/billing?finishTrial=true');
  await expect(page.getByText('End your trial now and pay £29 for Pro (monthly)?')).toBeVisible({ timeout: 20_000 });
  // Long enough for an automatic request to have gone out.
  await page.waitForTimeout(1500);
  expect(calls).toEqual([]);
  // A reload or "back" must not ask the server again.
  await expect(page).not.toHaveURL(/finishTrial/);

  await page.getByRole('button', { name: 'End trial and pay £29 now' }).click();
  await expect(page.getByText('Your trial has ended and the payment has been charged.')).toBeVisible();
  expect(calls).toEqual(['POST']);
});

test('after a paid trial it says the plan is active, not that the payment failed', async ({ page }) => {
  await routes(page, { finish: false, reason: 'no-trial' });
  await page.goto('/billing?finishTrial=true');
  await page.getByRole('button', { name: 'End trial and pay £29 now' }).click();
  await expect(page.getByText('Your trial has already ended - your plan is active.')).toBeVisible();
  await expect(page.getByText('We could not take the first payment yet')).toHaveCount(0);
});

test('the price is what Stripe will charge for this subscription, not today’s list price', async ({ page }) => {
  await routes(page, { finish: true }, { amount: 1200, currency: 'gbp', tier: 'STANDARD', period: 'MONTHLY' });
  await page.goto('/billing?finishTrial=true');
  await expect(page.getByText('End your trial now and pay £12 for Starter (monthly)?')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'End trial and pay £12 now' })).toBeVisible();
});
