import { expect, test } from '@playwright/test';

// Studio → Video → Stock B-roll: the late answer of an older search replaced
// the newer one's clips (the same race the photo panel had). The newest search
// wins.
test('a B-roll search typed while another is running shows its own clips', async ({ page }) => {
  test.setTimeout(60_000);
  const clip = (user: string, id: number) => ({
    hits: [{ id, duration: 8, pageURL: 'https://pixabay.com/videos/x/', tags: user, user, user_id: id, videos: {} }],
  });
  await page.route('**/api/media/pixabay-videos?*', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    if (q.includes('slow')) {
      await new Promise((r) => setTimeout(r, 3_000));
      await route.fulfill({ json: clip('OldClip', 1) });
    } else if (q.includes('fast')) {
      await route.fulfill({ json: clip('NewClip', 2) });
    } else {
      await route.fulfill({ json: clip('FirstClip', 3) });
    }
  });
  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Blank canvas/ }).click();
  await page.getByRole('button', { name: 'Video', exact: true }).click();
  await page.getByRole('button', { name: /Stock B-roll/ }).first().click();
  const box = page.getByPlaceholder('e.g. nature timelapse, city street, ocean');
  await expect(box).toBeVisible({ timeout: 30_000 });
  await box.fill('slow query');
  await box.press('Enter');
  await box.fill('fast query');
  await box.press('Enter');
  await expect(page.getByRole('link', { name: 'NewClip' })).toBeVisible();
  await page.waitForTimeout(3_500);
  await expect(page.getByRole('link', { name: 'NewClip' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'OldClip' })).toHaveCount(0);
});

// The search box opens on a starter phrase that is real text, not a
// placeholder. A click and a typed word searched for "nature timelapsecoffee";
// the phrase is selected on focus, as in the photo panel. Safari dropped that
// selection on the mouseup of the same click, so it runs in WebKit too.
test('typing into the B-roll search replaces the starter phrase', { tag: '@safari' }, async ({ page }) => {
  test.setTimeout(60_000);
  const asked: string[] = [];
  await page.route('**/api/media/pixabay-videos?*', async (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('q') || '');
    await route.fulfill({ json: { hits: [] } });
  });
  await page.goto('/studio?mode=video');
  await page.getByRole('button', { name: /Stock B-roll/ }).first().click();
  const box = page.getByRole('textbox', { name: 'Search' });
  await expect(box).toHaveValue('nature timelapse', { timeout: 30_000 });
  await box.click();
  await page.keyboard.type('coffee');
  await expect(box).toHaveValue('coffee');
  await page.keyboard.press('Enter');
  await expect.poll(() => asked.at(-1)).toBe('coffee');
});

// Two columns across the full Studio width made every clip about 600 px wide:
// one row filled the panel and its Import buttons were cut in half, with the
// rest of the results out of sight.
test('B-roll shows a row of clips with whole Import buttons', { tag: '@safari' }, async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const hits = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    duration: 8,
    pageURL: 'https://pixabay.com/videos/x/',
    tags: `clip ${i + 1}`,
    user: `Maker${i + 1}`,
    user_id: i + 1,
    videos: {},
  }));
  await page.route('**/api/media/pixabay-videos?*', (route) => route.fulfill({ json: { hits } }));
  await page.goto('/studio?mode=video');
  await page.getByRole('button', { name: /Stock B-roll/ }).first().click();
  const imports = page.getByRole('button', { name: 'Import', exact: true });
  await expect(imports).toHaveCount(8, { timeout: 30_000 });
  const first = await imports.first().boundingBox();
  const fourth = await imports.nth(3).boundingBox();
  // Four clips side by side on a laptop-width screen.
  expect(Math.abs((fourth?.y ?? 0) - (first?.y ?? -1))).toBeLessThan(2);
  // And the first Import button is whole inside the scrolling list.
  const inView = await imports.first().evaluate((b) => {
    const box = b.closest('.overflow-y-auto')!.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    return r.top >= box.top && r.bottom <= box.bottom;
  });
  expect(inView).toBe(true);
});

// The library picker ("From library") sits over every Video tab. Left open
// while switching to Stock B-roll, it hid the stock search: a word typed there
// searched the empty library and read "No videos in your library".
test('switching tab closes the library picker, so Stock B-roll shows its search @safari', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route('**/api/media/pixabay-videos?*', (route) =>
    route.fulfill({
      json: { hits: [{ id: 7, duration: 8, pageURL: 'https://pixabay.com/videos/x/', tags: 'coffee', user: 'CoffeeClip', user_id: 7, videos: {} }] },
    })
  );
  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Blank canvas/ }).click();
  await page.getByRole('button', { name: 'Video', exact: true }).click();
  await page.getByRole('button', { name: /AI Captions/ }).first().click();
  await page.getByRole('button', { name: 'From library', exact: true }).first().click();
  await expect(page.getByText('Library videos', { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /Stock B-roll/ }).first().click();
  await expect(page.getByText('Library videos', { exact: true })).toHaveCount(0);
  const box = page.getByPlaceholder('e.g. nature timelapse, city street, ocean');
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.fill('coffee');
  await box.press('Enter');
  await expect(page.getByText('CoffeeClip').first()).toBeVisible({ timeout: 15_000 });
});
