import { expect, test } from '@playwright/test';

// Billing page answers that arrive late or twice. The stack has no Stripe:
// routes answer.

// /billing/cancel toggles: a second press of "Reactivate subscription" while
// the first request ran cancelled the subscription again, under a
// "reactivated" message.
test('more presses of Reactivate while it runs do not cancel again', async ({ page }) => {
  const cancelAt = new Date(Date.now() + 20 * 86_400_000).toISOString();
  await page.route('**/api/user/subscription', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, subscription: { ...body.subscription, cancelAt } } });
  });
  const cancels: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/billing/cancel', async (route) => {
    cancels.push(route.request().method());
    await held;
    await route.fulfill({ json: { cancel_at: null } });
  });
  await page.goto('/billing');
  const reactivate = page.getByRole('button', { name: 'Reactivate subscription' });
  await reactivate.click();
  await expect.poll(() => cancels.length).toBe(1);
  // More presses while the first request is still out. The second used to
  // release the first one's guard, and the third went through.
  await reactivate.press('Enter');
  await reactivate.press('Enter');
  await reactivate.press('Enter');
  release();
  await expect(page.getByText('Subscription reactivated successfully')).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(cancels).toEqual(['POST']);
});

// The monthly quote is the page's first; switched to yearly before it came
// back, the late monthly answer replaced the yearly "Pay Today".
test('a late monthly quote does not replace the yearly one', async ({ page }) => {
  test.setTimeout(90_000);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let monthlyOut = 0;
  await page.route('**/api/billing/prorate', async (route) => {
    const { period } = route.request().postDataJSON();
    if (period === 'MONTHLY') {
      monthlyOut++;
      await held;
      return route.fulfill({ json: { price: 11.11 } });
    }
    return route.fulfill({ json: { price: 222.22 } });
  });
  await page.goto('/billing');
  await expect.poll(() => monthlyOut, { timeout: 20_000 }).toBeGreaterThan(0);
  await page.getByRole('switch', { name: 'Bill yearly' }).click();
  await expect(page.getByText('(Pay Today £222.22)').first()).toBeVisible();
  const late = page.waitForResponse((r) => r.url().endsWith('/api/billing/prorate') && r.request().postDataJSON().period === 'MONTHLY');
  release();
  await late;
  await page.waitForTimeout(1_000);
  await expect(page.getByText('(Pay Today £11.11)')).toHaveCount(0);
  await expect(page.getByText('(Pay Today £222.22)').first()).toBeVisible();
});
