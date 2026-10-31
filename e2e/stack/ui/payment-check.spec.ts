import { expect, test } from '@playwright/test';

// After a checkout the app polls /billing/check/<id> behind a full-screen
// loader. One failed request ended the polling with the loader still up, and a
// payment that stayed pending kept it up for good. The stack has no Stripe:
// routes answer.
const loader = (page: import('@playwright/test').Page) => page.locator('.fixed.bg-black\\/40');

test('a failed payment check is retried and the app comes back', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/billing/check/**', (route) => {
    calls++;
    if (calls === 1) return route.abort();
    if (calls === 2) return route.fulfill({ status: 503, body: 'Service Unavailable' });
    return route.fulfill({ json: { status: 2 } });
  });
  await page.goto('/launches?check=stack-check');
  await expect.poll(() => calls, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
  await expect(loader(page)).toHaveCount(0);
});

test('a payment that stays pending hands the app back with a note', async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install();
  await page.route('**/api/billing/check/**', (route) => route.fulfill({ json: { status: 0 } }));
  await page.goto('/launches?check=stack-check');
  await expect(loader(page)).toHaveCount(1, { timeout: 20_000 });
  // One poll a second for about two minutes; each waits for its answer, so
  // the clock moves a second at a time.
  const note = page.getByText('We could not confirm the payment yet.', { exact: false });
  for (let i = 0; i < 150 && !(await note.isVisible()); i++) {
    await page.clock.runFor(1_000);
  }
  await expect(note).toBeVisible();
  await expect(loader(page)).toHaveCount(0);
});
