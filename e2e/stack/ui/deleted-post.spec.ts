import { expect, test } from '@playwright/test';
import { createDraft, signedIn, stateFile } from '../helpers';

// A post deleted elsewhere (another tab, a teammate) while the calendar is
// open: clicking its tile said nothing and threw on data.posts[0]; now it
// says so and refreshes the calendar (upstream c1d55367). Organisation B.
test.use({ storageState: stateFile('b') });

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

test('opening a post deleted meanwhile says "Post not found", without an error', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const api = await signedIn('b');
  const text = `Deleted meanwhile ${Date.now()}`;
  const post = await createDraft(api, 'b', text);
  try {
    const day = new Date(Date.now() + 2 * 86_400_000);
    const monday = new Date(day);
    monday.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    await page.goto(`/launches?display=week&startDate=${isoDay(monday)}&endDate=${isoDay(sunday)}`);
    const tile = page.getByText(text).first();
    await expect(tile).toBeVisible();

    await api.delete(`/posts/${post.group}`);
    await tile.click();
    await expect(page.getByText('Post not found')).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await api.dispose();
  }
});
