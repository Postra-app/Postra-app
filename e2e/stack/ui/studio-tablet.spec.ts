import { expect, test } from '@playwright/test';
import { watchForErrors } from './ui-helpers';

// Studio on an iPad, both ways round: Safari's engine, a touch screen and
// iPadOS's user agent. Below 768 px Studio says it needs a bigger screen; from
// 768 up the editor has to fit and answer taps.
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

for (const [name, width, height] of [
  ['portrait', 768, 1024],
  ['landscape', 1024, 768],
] as const) {
  test.describe(`iPad ${name}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, userAgent: IPAD_UA });

    test(`Studio fits and answers taps (${width}x${height})`, { tag: '@safari' }, async ({ page }) => {
      const problems = watchForErrors(page);
      await page.goto('/studio');
      await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Studio needs a bigger screen')).toBeHidden();
      await page.getByRole('button', { name: /Blank canvas/ }).tap();

      // Nothing sticks out sideways: no page that scrolls left and right.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

      // A tap on the rail's Text adds a text, and the canvas, the format bar
      // and Export are all on screen to use it.
      await page.getByRole('button', { name: 'Text', exact: true }).first().tap();
      await page.getByRole('button', { name: 'Layers', exact: true }).first().tap();
      await expect(page.getByRole('button', { name: /^(Hide|Show)$/ })).toHaveCount(1);
      for (const el of [
        page.locator('canvas').first(),
        page.getByRole('button', { name: 'IG Feed (4:5)', exact: true }),
        page.getByRole('button', { name: 'Export' }),
      ]) {
        await expect(el).toBeInViewport();
      }
      await page.getByRole('button', { name: 'Export' }).tap();
      await expect(page.getByRole('menuitem', { name: /Download PNG/ })).toBeVisible();
      expect(problems).toEqual([]);
    });
  });
}
