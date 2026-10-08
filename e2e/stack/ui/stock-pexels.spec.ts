import { expect, test } from '@playwright/test';

// Studio → Stock photos: Pexels next to Pixabay once its key is set, with the
// link to Pexels and the photographer's credit its guidelines ask for, and a
// click imports the photo into the media library. The fake Pexels lives in
// fake-mastodon.mjs.

test('Pexels photos in the Studio show their credit and import on click', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Blank canvas/ }).click();
  await page.getByRole('button', { name: 'Stock photos', exact: true }).click();

  const pexels = page.getByRole('button', { name: 'Pexels', exact: true });
  await pexels.click();
  await expect(pexels).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: /Photos provided by Pexels/ })).toHaveAttribute(
    'href',
    'https://www.pexels.com'
  );

  await page.getByPlaceholder('e.g. coffee, office, summer').fill(`lemon tart ${Date.now()}`);
  await page.keyboard.press('Enter');
  const credit = page.getByRole('link', { name: 'Photo by Stack Photographer on Pexels' });
  await expect(credit).toBeVisible();
  await expect(credit).toHaveAttribute('href', 'https://www.pexels.com/@stack');

  const imported = page.waitForResponse(
    (r) => r.url().endsWith('/media/pexels-images/import') && r.request().method() === 'POST'
  );
  await page.getByTitle(/Stack Photographer \(Pexels\)/).click();
  expect((await imported).status()).toBe(201);
});
