import { expect, test } from '@playwright/test';

// Opening /billing?finishTrial=true ended the trial and charged the card at
// once — no price, no question — and a reload after the payment said "We could
// not take the first payment yet". The stack has no Stripe: the billing routes
// are answered here.
const routes = async (
  page: import('@playwright/test').Page,
  answer: object,
  preview: object = { amount: 2900, currency: 'gbp', tier: 'PRO', period: 'MONTHLY' }
) => {
  const calls: string[] = [];
  // What Stripe would charge for this subscription right now (the price list is
  // wrong for an older price or a discount).
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

// A failed request left the dialog spinning for good, and after a payment the
// open app kept the trial's limits until a reload.
test('a failed end-of-trial request says so instead of spinning', async ({ page }) => {
  await routes(page, { finish: true });
  await page.route('**/api/billing/finish-trial', (route) => route.abort());
  await page.goto('/billing?finishTrial=true');
  await page.getByRole('button', { name: 'End trial and pay £29 now' }).click();
  await expect(page.getByText('We could not take the first payment yet. Your bank may need you to confirm it.')).toBeVisible();
});

test('after the trial is paid the app loads the new limits', async ({ page }) => {
  await routes(page, { finish: true });
  let selfLoads = 0;
  page.on('request', (r) => {
    if (r.method() === 'GET' && new URL(r.url()).pathname === '/api/user/self') selfLoads++;
  });
  await page.goto('/billing?finishTrial=true');
  await page.getByRole('button', { name: 'End trial and pay £29 now' }).waitFor();
  const before = selfLoads;
  await page.getByRole('button', { name: 'End trial and pay £29 now' }).click();
  await expect(page.getByText('Your trial has ended and the payment has been charged.')).toBeVisible();
  await expect.poll(() => selfLoads).toBeGreaterThan(before);
});

// On a phone the window ran off both edges: no close button, the sentence
// with the amount cut off, and Escape did nothing.
test('on a phone the whole window fits, and Escape closes it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await routes(page, { finish: true });
  await page.goto('/billing?finishTrial=true');
  const dialog = page.getByRole('dialog', { name: 'Finishing your trial' });
  await expect(dialog.getByText('End your trial now and pay £29 for Pro (monthly)?')).toBeVisible({ timeout: 20_000 });
  for (const part of [dialog, dialog.getByRole('button', { name: 'Close' }), dialog.getByRole('button', { name: 'End trial and pay £29 now' })]) {
    const box = (await part.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(calls).toEqual([]);
});

// A trial started without a card: ending it now would cancel it in Stripe
// instead of charging. The dialog asks for a card first, on Stripe's own page,
// and comes back to confirm the payment.
test('a trial without a card is asked for one before anything is charged', async ({ page }) => {
  const calls = await routes(page, { finish: true }, { amount: 2900, currency: 'gbp', tier: 'PRO', period: 'MONTHLY', hasCard: false });
  const portals: string[] = [];
  await page.route('**/api/billing/portal**', (route) => {
    portals.push(route.request().url());
    return route.fulfill({ json: { portal: 'http://localhost:54000/billing?portal=stub' } });
  });
  await page.goto('/billing?finishTrial=true');
  await expect(
    page.getByText('To end the trial now and start your plan, add a card first. You come back here to confirm the payment.')
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /End trial and pay/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add a card' }).click();
  await page.waitForURL(/portal=stub/);
  expect(portals.map((u) => new URL(u).searchParams.get('flow'))).toEqual(['card-now']);
  expect(calls).toEqual([]);
});
