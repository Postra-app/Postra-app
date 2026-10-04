import { expect, test } from '@playwright/test';
import { createDraft, signedIn, stateFile } from '../helpers';

// A post in the calendar opens from the keyboard, and its actions (duplicate,
// preview, delete…) appear on focus, not only on mouse hover. Both were divs
// that Tab never reached. Organisation B: a draft in A's calendar would sit
// under the other UI tests' clicks.
test.use({ storageState: stateFile('b') });

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

test('Tab reaches a post, its actions show, Enter opens it', async ({ page }) => {
  const api = await signedIn('b');
  const text = `Keyboard post ${Date.now()}`;
  const post = await createDraft(api, 'b', text);
  try {
    // createDraft dates the post two days ahead; show that week.
    const day = new Date(Date.now() + 2 * 86_400_000);
    const monday = new Date(day);
    monday.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    await page.goto(`/launches?display=week&startDate=${isoDay(monday)}&endDate=${isoDay(sunday)}`);

    const tile = page.getByRole('button', { name: new RegExp(text) });
    await tile.focus();
    await expect(page.getByRole('button', { name: 'Preview Post' }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ProseMirror').first()).toContainText(text);
  } finally {
    await api.delete(`/posts/${post.group}`);
    await api.dispose();
  }
});
