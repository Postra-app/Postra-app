import { expect, test } from '@playwright/test';
import { stateFile } from '../helpers';

// A toast had a fixed 56 px height with overflow hidden: any message longer
// than one line lost its first and last line (measured on prod 2026-10-07 at
// 390 px: text 72 px tall in a 56 px box). The empty channel list gives a
// known two-to-three-line warning without saving anything.
test.use({ storageState: stateFile('a'), viewport: { width: 390, height: 844 } });

test('a long toast is shown in full on a phone', async ({ page }) => {
  await page.route('**/integrations/list', (route) =>
    route.fulfill({ json: { integrations: [] } })
  );
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Sets' }).click();
  await page.getByRole('button', { name: 'Add a set' }).click();

  const text = page.getByText('Connect a channel first', { exact: false }).first();
  await expect(text).toBeVisible();
  const { t, b } = await text.evaluate((el) => {
    const box = el.closest('[class*="animate-fadeDown"]') as HTMLElement;
    const r = (e: Element) => e.getBoundingClientRect();
    return { t: { top: r(el).top, bottom: r(el).bottom, h: r(el).height }, b: { top: r(box).top, bottom: r(box).bottom } };
  });
  expect(t.h, 'the message wraps').toBeGreaterThan(30);
  expect(t.top).toBeGreaterThanOrEqual(b.top);
  expect(t.bottom).toBeLessThanOrEqual(b.bottom);
});
