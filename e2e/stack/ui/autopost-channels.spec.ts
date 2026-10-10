import { expect, test } from '@playwright/test';

// 2026-10-10 on prod: a new Auto Post feed started on "All integrations", so
// one unguarded Save would post every new article, written by AI, to every
// channel the organisation has, a personal profile included. A new feed now
// starts on "Specific integrations" and cannot be saved without a channel.
test('a new Auto Post feed starts with no channels chosen', async ({ page }) => {
  await page.goto('/autopost');
  await page.getByRole('button', { name: 'Add an autopost', exact: true }).click();
  const channels = page.locator('select').filter({ has: page.locator('option[value="specific"]') });
  await expect(channels).toHaveValue('specific');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
});
