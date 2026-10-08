import { expect, test } from '@playwright/test';

// Studio → Video → Stock B-roll: the late answer of an older search replaced
// the newer one's clips (the same race the photo panel had, prod 10-08 (e)).
// The newest search wins.
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
