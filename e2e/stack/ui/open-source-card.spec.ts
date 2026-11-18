import { expect, test } from '@playwright/test';

// The web bundle drops the licence comments of the packages in it, so the
// Open source card points to the page that lists their licences and
// copyright notices, next to the source code offer.
test('the Open source card links to the source code and to the third-party licences', async ({ page }) => {
  await page.goto('/settings');
  const card = page.getByText('Open source', { exact: true }).locator('xpath=..');
  await expect(card.getByRole('link', { name: 'github.com/Postra-app/Postra-app' })).toBeVisible();
  const licences = card.getByRole('link', { name: 'postra.co.uk/licences' });
  await expect(licences).toHaveAttribute('href', 'https://postra.co.uk/licences/');
  await expect(licences).toHaveAttribute('target', '_blank');
});
