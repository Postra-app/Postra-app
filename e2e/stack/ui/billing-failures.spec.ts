import { expect, test } from '@playwright/test';
import { addMember, database, throwawayOrg } from '../helpers';

// Billing when an answer is not the one expected. The stack has no Stripe:
// routes answer.

// A failed /user/subscription read as "no subscription": a paying
// organisation saw three "Purchase plan" buttons, and a press changed the
// plan at once, without the window that shows the amount.
for (const status of [503, 429]) {
  test(`a ${status} on the plan shows an error with Try again, not plans to buy`, async ({ page }) => {
    let fail = true;
    const subscribe: string[] = [];
    await page.route('**/api/user/subscription', (route) =>
      fail ? route.fulfill({ status, json: { message: 'unavailable' } }) : route.fallback()
    );
    await page.route('**/api/billing/subscribe', (route) => {
      subscribe.push(route.request().method());
      return route.fulfill({ json: {} });
    });
    await page.goto('/billing');
    await expect(page.getByText('We could not load your plan')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Purchase plan/ })).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('button', { name: 'Current plan' })).toBeVisible({ timeout: 20_000 });
    expect(subscribe).toEqual([]);
  });
}

// A member (USER) is refused on every billing route; Billing offered three
// "Purchase plan" buttons, each a 403, and the full-library bar linked there.
test('a member sees who manages the plan, and no plans to buy', async ({ browser }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const member = await addMember(prisma, org.orgId, 'USER');
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    await context.addCookies((await member.api.storageState()).cookies);
    const page = await context.newPage();
    const refused: string[] = [];
    page.on('response', (r) => r.status() === 403 && r.url().includes('/api/') && refused.push(r.url()));
    await page.route('**/api/media/storage', (route) => route.fulfill({ json: { used: 10, limit: 10 } }));
    await page.goto('/billing');
    await expect(page.getByText('Plans are managed by an admin')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Purchase plan/ })).toHaveCount(0);
    await page.goto('/media');
    await expect(page.getByTestId('media-storage-full')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('media-storage-full')).not.toHaveAttribute('href', /.*/);
    expect(refused.filter((u) => u.includes('/subscription') || u.includes('/billing'))).toEqual([]);
  } finally {
    await context.close();
    await member.remove();
    await org.remove();
    await prisma.$disconnect();
  }
});

// A double click on "Purchase plan" opened two windows with the amount, one on
// the other, and approving both sent two POST /billing/subscribe.
test('a double click on Purchase plan asks once and changes once', async ({ page }) => {
  const prorates: string[] = [];
  const subscribe: string[] = [];
  let clicked = false;
  await page.route('**/api/billing/prorate', (route) => {
    if (clicked) prorates.push(route.request().method());
    return route.fulfill({ json: { price: 49.68, renewsOn: '2026-12-09T09:35:51.000Z', renewalPrice: 79 } });
  });
  await page.route('**/api/billing/subscribe', (route) => {
    subscribe.push(route.request().method());
    return route.fulfill({ json: {} });
  });
  await page.goto('/billing');
  await expect(page.getByText('(Pay Today £49.68)').last()).toBeVisible({ timeout: 20_000 });
  clicked = true;
  await page.getByRole('button', { name: /Purchase plan/ }).last().dblclick();
  await expect(page.getByRole('button', { name: 'Upgrade and pay £49.68' })).toHaveCount(1);
  await page.waitForTimeout(1_000);
  await expect(page.getByRole('button', { name: 'Upgrade and pay £49.68' })).toHaveCount(1);
  expect(prorates).toEqual(['POST']);
  await page.getByRole('button', { name: 'Upgrade and pay £49.68' }).click();
  await expect.poll(() => subscribe).toEqual(['POST']);
  await page.waitForTimeout(1_000);
  expect(subscribe).toEqual(['POST']);
});

// A failed quote comes back as {price: 0} and read "(Pay Today £0.00)" next
// to an upgrade; a refused one (429) left the spinner turning.
test('without a quote there is no "Pay Today" and no endless spinner', async ({ page }) => {
  let status = 200;
  await page.route('**/api/billing/prorate', (route) =>
    status === 200 ? route.fulfill({ json: { price: 0 } }) : route.fulfill({ status, json: { message: 'Too many requests' } })
  );
  await page.goto('/billing');
  await expect(page.getByRole('button', { name: /Purchase plan/ }).last()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2_000);
  await expect(page.getByText(/Pay Today/)).toHaveCount(0);
  status = 429;
  await page.getByRole('switch', { name: 'Bill yearly' }).click();
  await page.waitForTimeout(3_000);
  await expect(page.locator('div[style*="width: 20px"][style*="spin"]')).toHaveCount(0);
  await expect(page.getByText(/Pay Today/)).toHaveCount(0);
});

// Cancelling: the feedback window demanded 20 characters, and closing it with
// the cross or Escape cancelled nothing and said nothing; the customer
// believed the plan was gone. Feedback is optional now.
test.describe('cancelling the subscription', () => {
  const routes = async (page: import('@playwright/test').Page) => {
    const cancels: Array<{ feedback: string; cancel: boolean }> = [];
    await page.route('**/api/billing/check-discount', (route) => route.fulfill({ json: { offerCoupon: false } }));
    await page.route('**/api/billing/cancel', (route) => {
      cancels.push(route.request().postDataJSON());
      return route.fulfill({ json: { cancel_at: new Date(Date.now() + 20 * 86_400_000).toISOString() } });
    });
    return cancels;
  };
  const open = async (page: import('@playwright/test').Page) => {
    await page.goto('/billing');
    await page.getByRole('button', { name: 'Cancel subscription', exact: true }).click({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Yes, cancel' }).click();
    await expect(page.getByText('We are sorry to see you go :(')).toBeVisible();
  };

  test('goes through without any feedback', async ({ page }) => {
    const cancels = await routes(page);
    await open(page);
    await page.getByRole('button', { name: 'Cancel Subscription', exact: true }).click();
    await expect(page.getByText('Subscription set to canceled successfully')).toBeVisible();
    expect(cancels).toEqual([{ feedback: '', cancel: true }]);
  });

  for (const how of ['the cross', 'Escape']) {
    test(`closing the feedback window with ${how} says nothing was cancelled`, async ({ page }) => {
      const cancels = await routes(page);
      await open(page);
      if (how === 'Escape') await page.keyboard.press('Escape');
      else await page.getByRole('dialog').getByRole('button', { name: /close/i }).click();
      await expect(page.getByText('Your subscription was not cancelled.')).toBeVisible();
      expect(cancels).toEqual([]);
      // And the button works again.
      await page.getByRole('button', { name: 'Cancel subscription', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Yes, cancel' })).toBeVisible();
    });
  }
});
