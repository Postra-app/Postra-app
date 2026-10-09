import { expect, test } from '@playwright/test';

// Kris Company, 2026-10-09: after Business → Starter the server said Starter
// (3 channels, X and Discord refused with 402), but the open tab still
// offered every platform in Add Channel. A plan change must bring the new
// plan's limits into the page without a reload. The stack has no Stripe:
// routes answer, and /user/self reports Starter once the change is made.
test('after a plan change Add Channel locks what the new plan does not have', async ({ page }) => {
  let changed = false;
  await page.route('**/api/billing/prorate', (route) =>
    route.fulfill({ json: { price: 0, renewsOn: '2026-11-09T09:35:51.000Z', renewalPrice: 19 } })
  );
  await page.route('**/api/billing/subscribe', (route) => {
    changed = true;
    return route.fulfill({ json: {} });
  });
  await page.route('**/api/user/self', async (route) => {
    const response = await route.fetch();
    const self = await response.json();
    return route.fulfill({
      response,
      json: changed ? { ...self, tier: 'STANDARD', totalChannels: 3 } : self,
    });
  });

  await page.goto('/billing');
  // Organisation A is on Pro: Starter is the first card.
  await page.getByRole('button', { name: /Purchase plan/ }).first().click();
  // Organisation A has two people; Starter has one seat.
  await page.getByRole('button', { name: 'Yes, continue' }).click();
  // The quote answers as for a change made at once (in a trial); a paid plan
  // would wait for the renewal (plan-change-confirm.spec).
  await page.getByRole('button', { name: 'Change plan' }).click();
  await expect.poll(() => changed).toBe(true);

  await page.getByRole('link', { name: 'Calendar' }).first().click();
  await page.getByRole('button', { name: 'Add Channel' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add Channel' });
  await expect(dialog).toContainText('3 of 3 channels used');
  await expect(dialog).toContainText(/YouTube\s*🔒\s*Pro/);
  await expect(dialog).toContainText(/X\s*🔒\s*Business/);
});

// The same account, with the plan changed in another tab: this tab learns of
// it when the user comes back to it, not only after a reload.
test('a tab left open picks up a plan changed elsewhere when it is back in focus', async ({ page }) => {
  let changed = false;
  await page.route('**/api/user/self', async (route) => {
    const response = await route.fetch();
    const self = await response.json();
    return route.fulfill({
      response,
      json: changed ? { ...self, tier: 'STANDARD', totalChannels: 3 } : self,
    });
  });
  await page.clock.install();
  await page.goto('/launches');
  await expect(page.getByRole('button', { name: 'Add Channel' }).first()).toBeVisible();

  changed = true;
  // A user comes back after minutes; SWR asks again on focus at most every
  // 30 s, counted from the page load (focusThrottleInterval in SwrProvider).
  await page.clock.fastForward('00:31');
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.getByRole('button', { name: 'Add Channel' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add Channel' });
  await expect(dialog).toContainText(/\d+ of 3 channels used/);
  await expect(dialog).toContainText(/YouTube\s*🔒\s*Pro/);
});
