import { expect, test } from '@playwright/test';

// Plugs (docs P3 check, 2026-10-09): saving a plug said "Plugin updated" even
// when the save failed, and the empty page asked for "an X, LinkedIn or
// Threads channel" — LinkedIn has no plugs, Bluesky does.
test('a plug that could not be saved says so and stays open', async ({ page }) => {
  await page.route('**/integrations/*/plugs', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
      : route.continue()
  );
  await page.goto('/plugs');
  await page.getByText('Auto Repost Posts').first().click();
  await page.getByPlaceholder('Amount of likes').fill('10');
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText('Could not save the plug', { exact: false })).toBeVisible();
  await expect(page.getByText('Plugin updated')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Activate' })).toBeVisible();
});
