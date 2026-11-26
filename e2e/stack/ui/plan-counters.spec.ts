import { expect, test } from '@playwright/test';
import { database, signedIn, stateFile, throwawayOrg } from '../helpers';

// Nine platform tiles in Add Channel read as nine channels on Pro. The window
// says how many social accounts are connected of the plan's limit, and Teams says how many
// seats are used.
test('Add Channel says how many of the plan’s channels are used', async ({ page }) => {
  const api = await signedIn('a');
  const self = await (await api.get('/user/self')).json();
  const used = (await (await api.get('/integrations/list')).json()).integrations.filter(
    (i: { disabled?: boolean }) => !i.disabled
  ).length;
  await api.dispose();

  await page.goto('/launches');
  await page.getByRole('button', { name: 'Add Channel' }).first().click();
  // One number, social accounts, as the landing counts them: the second
  // number ("pick any of the 10 platforms below") read as more channels.
  await expect(
    page.getByText(`${used} of ${self.totalChannels} social accounts connected · Pro`, { exact: true })
  ).toBeVisible();
  await expect(page.getByText(/platforms below/)).toHaveCount(0);
});

test('Teams says how many seats are used', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Teams' }).click();
  // Organisation A (Pro, 2 seats) has its owner and one member.
  await expect(page.getByText('2 of 2 seats used')).toBeVisible();
});

test.describe('Business', () => {
  test.use({ storageState: stateFile('c-owner') });

  test('Webhooks say unlimited, as the plan does, not a technical 10000', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Webhooks' }).click();
    await expect(page.getByText(/^Webhooks \(\d+ · unlimited\)$/)).toBeVisible();
    await expect(page.getByText(/\/10000/)).toHaveCount(0);
  });
});

// A trial at its 2 channels: the window says it is the trial's limit and what
// the plan has; clicking a platform anyway answers the same, with "End the
// trial now" instead of "Go to billing".
test.describe(() => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('a trial at its channel limit says so, and offers to end the trial', async ({ page, context }) => {
    const prisma = database();
    const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 8, channels: 2, isTrailing: true });
    try {
      await context.addCookies((await org.api.storageState()).cookies);
      await page.goto('/launches');
      await page.getByRole('button', { name: 'Add Channel' }).first().click({ timeout: 20_000 });
      await expect(
        page.getByText(
          '2 of 2 social accounts connected: the free trial includes 2. End the trial in Billing to connect up to 8 on Pro.',
          { exact: true }
        )
      ).toBeVisible();

      await page.getByText('Mastodon', { exact: true }).first().click();
      const dialog = page.getByRole('dialog').filter({ hasText: 'Free trial limit' });
      await expect(
        dialog.getByText('Your free trial includes 2 channels. Your Pro plan includes 8 channels. End the trial to start your plan now.')
      ).toBeVisible({ timeout: 20_000 });
      await expect(dialog.getByRole('button', { name: 'End the trial now' })).toBeVisible();
      await expect(page.getByText('Go to billing')).toHaveCount(0);
    } finally {
      await org.remove();
      await prisma.$disconnect();
    }
  });
});
