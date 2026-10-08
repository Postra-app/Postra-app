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

test('Unsplash photos in the Studio credit the photographer and Unsplash, and import on click', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Blank canvas/ }).click();
  await page.getByRole('button', { name: 'Stock photos', exact: true }).click();

  await page.getByRole('button', { name: 'Unsplash', exact: true }).click();
  await expect(page.getByRole('link', { name: /Photos from Unsplash/ })).toBeVisible();
  await page.getByPlaceholder('e.g. coffee, office, summer').fill(`rye loaf ${Date.now()}`);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Stack Lens' })).toHaveAttribute(
    'href',
    'https://unsplash.com/@stacklens?utm_source=postra&utm_medium=referral'
  );
  await expect(page.getByRole('link', { name: 'Unsplash', exact: true })).toBeVisible();

  const imported = page.waitForResponse(
    (r) => r.url().endsWith('/media/unsplash-images/import') && r.request().method() === 'POST'
  );
  await page.getByTitle(/Stack Lens \(Unsplash\)/).click();
  expect((await imported).status()).toBe(201);
});

// Prod 10-08 (e): switching to Unsplash starts a search; a new query typed
// while it ran was dropped (`if (searching) return`) and the panel showed the
// old query's photos. The newest query wins, and a late answer is ignored.
test('a search typed while another is running shows its own photos', async ({ page }) => {
  test.setTimeout(60_000);
  const hit = (user: string) => ({
    hits: [
      {
        id: user,
        previewURL: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
        importURL: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
        pageURL: 'https://unsplash.com/photos/x?utm_source=postra&utm_medium=referral',
        user,
        userURL: `https://unsplash.com/@${user}?utm_source=postra&utm_medium=referral`,
        alt: '',
        downloadLocation: '',
      },
    ],
  });
  await page.route('**/api/media/unsplash-images?*', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    if (q.includes('slow')) {
      await new Promise((r) => setTimeout(r, 3_000));
      await route.fulfill({ json: hit('OldLens') });
    } else if (q.includes('fast')) {
      await route.fulfill({ json: hit('NewLens') });
    } else {
      await route.fulfill({ json: hit('FirstLens') });
    }
  });
  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Blank canvas/ }).click();
  await page.getByRole('button', { name: 'Stock photos', exact: true }).click();
  await page.getByRole('button', { name: 'Unsplash', exact: true }).click();
  // The panel's own first search, done before the two that race.
  await expect(page.getByRole('link', { name: 'FirstLens' })).toBeVisible();
  const box = page.getByPlaceholder('e.g. coffee, office, summer');
  await box.fill('slow query');
  await box.press('Enter');
  await box.fill('fast query');
  await box.press('Enter');
  await expect(page.getByRole('link', { name: 'NewLens' })).toBeVisible();
  await page.waitForTimeout(3_500);
  await expect(page.getByRole('link', { name: 'NewLens' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'OldLens' })).toHaveCount(0);
});
