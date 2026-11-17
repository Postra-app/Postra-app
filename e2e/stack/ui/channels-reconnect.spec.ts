import { expect, test, type BrowserContext } from '@playwright/test';
import { database, stateFile, throwawayOrg } from '../helpers';

// Fixing a channel and connecting one, when the answer is not a plain success.
test.use({ storageState: { cookies: [], origins: [] } });

const signedInto = async (context: BrowserContext, org: Awaited<ReturnType<typeof throwawayOrg>>) =>
  context.addCookies((await org.api.storageState()).cookies);

// Bluesky, WordPress and Telegram carry a state, not an address: "click to
// reconnect" opened it as a page of ours, a 404. On a full plan the
// credentials form then asked for a bigger plan.
test('a Bluesky channel to reconnect opens its credentials, on a full plan too', async ({ page, context }) => {
  const prisma = database();
  // One slot, taken by the channel being fixed.
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 1, channels: 1, provider: 'bluesky' });
  try {
    await prisma.integration.update({ where: { id: org.channelIds[0] }, data: { refreshNeeded: true } });
    await signedInto(context, org);
    // The last hop goes to bsky.social; answer it here.
    const connects: string[] = [];
    await page.route('**/api/integrations/social-connect/bluesky', (route) => {
      connects.push(route.request().method());
      return route.fulfill({ json: { id: org.channelIds[0], inBetweenSteps: false } });
    });
    await page.route('**/api/integrations/social-connect/bluesky/handoff*', (route) => route.fulfill({ json: {} }));
    await page.goto('/launches');
    await page.getByText('Throwaway bluesky 0').first().click({ timeout: 20_000 });
    const form = page.getByRole('dialog', { name: 'Update credentials' });
    await expect(form).toBeVisible();
    await expect(page).not.toHaveURL(/404|\/[A-Za-z0-9]{6}$/);
    await form.getByLabel('Identifier').fill('cafe.bsky.social');
    await form.getByRole('textbox', { name: 'Password' }).fill('app-password-1234');
    const asked = page.waitForResponse((r) => r.url().includes('/api/integrations/social/bluesky?refresh='));
    await form.getByRole('button', { name: 'Connect' }).click();
    expect((await asked).status()).toBe(200);
    await expect(page.getByText('Payment required')).toHaveCount(0);
    await expect.poll(() => connects).toEqual(['POST']);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

test('a Telegram channel to reconnect opens the Telegram steps, not a 404', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1, provider: 'telegram' });
  try {
    await prisma.integration.update({ where: { id: org.channelIds[0] }, data: { refreshNeeded: true } });
    await signedInto(context, org);
    await page.goto('/launches');
    await page.getByText('Throwaway telegram 0').first().click({ timeout: 20_000 });
    await expect(page.getByRole('dialog', { name: 'Reconnect channel' })).toBeVisible();
    await expect(page.getByText('404')).toHaveCount(0);
    await expect(page).toHaveURL(/\/launches/);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

// A box unticked on the consent screen read "Not enough scopes, when
// choosing a provider, please add all the scopes".
test('a permission left unticked at the platform says which and what to do', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    await signedInto(context, org);
    await page.route('**/api/integrations/social-connect/youtube/handoff*', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/integrations/social-connect/youtube', (route) =>
      route.fulfill({
        status: 409,
        json: {
          msg: 'The platform did not grant every permission Postra needs. Connect again and leave all the boxes ticked.',
          code: 'not_enough_scopes',
        },
      })
    );
    await page.goto('/integrations/social/youtube?code=c&state=s');
    await expect(
      page.getByText('YouTube did not grant every permission Postra needs. Connect again and leave all the boxes ticked.')
    ).toBeVisible({ timeout: 20_000 });
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

// A failed GET /third-party (a menu entry for a feature we do not offer)
// took the whole screen down: the composer could not be opened.
for (const status of [503, 429]) {
  test.describe(() => {
    test.use({ storageState: stateFile('a') });
    test(`a ${status} on the third-party list does not stop the composer`, async ({ page }) => {
      const crashes: string[] = [];
      page.on('pageerror', (e) => crashes.push(e.message));
      await page.route('**/api/third-party', (route) => route.fulfill({ status, body: 'upstream' }));
      await page.goto('/launches');
      await page.getByRole('button', { name: 'Create Post' }).first().click({ timeout: 20_000 });
      await page.waitForTimeout(5_000);
      await expect(page.getByRole('dialog', { name: 'Post editor' })).toBeVisible();
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
      expect(crashes.filter((m) => m.includes('length'))).toEqual([]);
    });
  });
}

// A tab the app opened itself (Go to billing, Help) has an opener, and closed
// itself on reaching the calendar: right after paying for a bigger plan.
// Only the OAuth popup closes itself.
test('a tab the app opened stays open on the calendar', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  try {
    await signedInto(context, org);
    await page.goto('/launches');
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      page.evaluate(() => window.open('/launches', '_blank')),
    ]);
    await tab.waitForLoadState();
    await tab.waitForTimeout(3_000);
    expect(tab.isClosed()).toBe(false);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
