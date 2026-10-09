import { expect, test } from '@playwright/test';
import { signedIn } from '../helpers';

// K. 10-09 on Kris Company: nine platform tiles in Add Channel read as nine
// channels on Pro. The window says how many channels are used of the plan's
// limit, and Teams says how many seats are used.
test('Add Channel says how many of the plan’s channels are used', async ({ page }) => {
  const api = await signedIn('a');
  const self = await (await api.get('/user/self')).json();
  const used = (await (await api.get('/integrations/list')).json()).integrations.filter(
    (i: { disabled?: boolean }) => !i.disabled
  ).length;
  await api.dispose();

  await page.goto('/launches');
  await page.getByRole('button', { name: 'Add Channel' }).first().click();
  await expect(
    page.getByText(new RegExp(`^${used} of ${self.totalChannels} channels used · Pro`))
  ).toBeVisible();
  await expect(page.getByText(/pick any of the 9 platforms below/)).toBeVisible();
});

test('Teams says how many seats are used', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Teams' }).click();
  // Organisation A (Pro, 2 seats) has its owner and one member.
  await expect(page.getByText('2 of 2 seats used')).toBeVisible();
});

test.describe('Business', () => {
  test.use({ storageState: require('../helpers').stateFile('c') });

  test('Webhooks say unlimited, as the plan does, not a technical 10000', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Webhooks' }).click();
    await expect(page.getByText(/^Webhooks \(\d+ · unlimited\)$/)).toBeVisible();
    await expect(page.getByText(/\/10000/)).toHaveCount(0);
  });
});
