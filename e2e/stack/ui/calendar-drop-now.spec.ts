import { expect, test } from '@playwright/test';
import { createDraft, signedIn, stateFile } from '../helpers';
import { dragWithMouse, weekOf } from './ui-helpers';

// E2E-05-99: the current hour's cell accepts a drop (it is not "before now"),
// and the post was then saved at the start of that hour: a time already gone,
// which the scheduler publishes at once. The drop must never send a time in
// the past; it goes to the next full hour instead.
test.use({ storageState: stateFile('b') });

test('a post dropped on the current hour is not scheduled in the past', async ({
  page,
}) => {
  // The calendar lives in the browser's zone (Europe/London in this config),
  // which is not the test runner's; read the current hour's slot there.
  await page.goto(weekOf(new Date()));
  const current = await page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return {
      hour: d.getHours(),
      slot: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
        d.getHours()
      )}:00`,
    };
  });
  // Needs a later hour today for the source tile; the last hours of the day
  // cannot have one.
  test.skip(current.hour >= 22, 'no later hour today to drag from');

  const api = await signedIn('b');
  const text = `Drop on now ${Date.now()}`;
  const later = new Date(Date.now() + 2 * 3_600_000);
  later.setUTCMinutes(15, 0, 0);
  const post = await createDraft(api, 'b', text, later);
  try {
    let sent: { date: string } | undefined;
    await page.route(`**/posts/${post.id}/date`, async (route) => {
      sent = route.request().postDataJSON();
      await route.continue();
    });
    await page.goto(weekOf(new Date()));
    const tile = page.locator('[role=button]', { hasText: text });
    await expect(tile).toBeVisible();
    const target = page.locator(`[data-slot="${current.slot}"]`);
    await expect(target).not.toHaveClass(/cursor-not-allowed/);
    await dragWithMouse(page, tile, target);
    await expect.poll(() => sent, { timeout: 10_000 }).toBeTruthy();
    const saved = new Date(sent!.date + 'Z');
    expect(
      saved.getTime(),
      `sent ${sent!.date}, now ${new Date().toISOString()}`
    ).toBeGreaterThan(Date.now() - 1000);
  } finally {
    await api.delete(`/posts/${post.group}`);
    await api.dispose();
  }
});
