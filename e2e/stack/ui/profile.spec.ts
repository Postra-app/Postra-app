import { expect, test } from '@playwright/test';

// K21 (2026-10-10): the web app had no way to change your name, bio or
// picture — the settings form loaded and saved them but showed no fields.
test('Global Settings change your name and bio, and they stay', async ({ page }) => {
  await page.goto('/settings');
  const card = page.getByText('Profile', { exact: true }).locator('xpath=ancestor::*[contains(@class,"p-[24px]")][1]');
  await expect(page.getByLabel('Full Name')).toBeVisible();
  const original = await page.getByLabel('Full Name').inputValue();
  const name = `Stack Profile ${Date.now()}`;
  try {
    await page.getByLabel('Full Name').fill(name);
    await page.getByLabel('Bio').fill('Plans the posts.');
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Profile updated')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Full Name')).toHaveValue(name);
    await expect(page.getByLabel('Bio')).toHaveValue('Plans the posts.');
  } finally {
    await page.request.post('/api/user/personal', { data: { fullname: original || 'Stack User', bio: '' } });
  }
});
