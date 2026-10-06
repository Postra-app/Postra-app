import { expect, test } from '@playwright/test';

// The web app at phone width (390 px, iPhone 14/15): no screen scrolls
// sideways (P8). A page wider than the phone hides its right edge — often
// the button that matters.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const SCREENS = [
  '/launches',
  '/launches?display=day',
  '/launches?display=list',
  '/settings',
  '/media',
  '/analytics',
  '/agents',
  '/plugs',
  '/help',
  '/billing',
];

for (const screen of SCREENS) {
  test(`390 px: ${screen} does not scroll sideways`, async ({ page }) => {
    await page.goto(screen);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => window.innerWidth)).toBe(390);
    const overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      return [...document.querySelectorAll('body *')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return r.width > 0 && r.right > width + 1 && style.position !== 'fixed' &&
            !el.closest('[class*="overflow-x-auto"], [class*="overflow-auto"], .overflow-hidden');
        })
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(el.getBoundingClientRect().right)}px`);
    });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect({ scrollWidth, overflow }).toEqual({ scrollWidth: 390, overflow: [] });
  });
}

// The Agent's chat history on a phone: with many chats every row was squeezed
// below its text and the titles were cut in half (seen on production with 20
// chats). The list is answered in this browser only.
test('the chat history drawer shows every title whole', async ({ page }) => {
  await page.route('**/api/copilot/list', (route) =>
    route.fulfill({
      json: {
        threads: Array.from({ length: 24 }, (_, i) => ({
          id: `stack-thread-${i}`,
          title: `List connected channel names ${i}`,
        })),
      },
    })
  );
  await page.goto('/agents');
  await page.getByRole('button', { name: 'Chat history' }).click();
  const rows = page.getByRole('link', { name: /List connected channel names/ });
  await expect(rows).toHaveCount(24);
  const clipped = await rows.evaluateAll((links) =>
    links.filter((a) => a.scrollHeight > a.clientHeight + 1).length
  );
  expect(clipped).toBe(0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(rows).toHaveCount(0);
});

// The composer, after a channel is picked: its toolbar and character counter
// were one row wider than the phone, and the editor ran 13 px off screen —
// clipped, so the page-wide check above (which skips overflow-hidden) missed it.
test('390 px: the composer fits the screen with a channel picked', async ({ page }) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Create Post' }).first().click();
  await page.getByRole('img', { name: 'bluesky', exact: true }).first().click();
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('Phone width check');
  const cut = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const editor = document.querySelector('.ProseMirror')!;
    let panel: Element = editor;
    while (panel.parentElement && !panel.parentElement.className.toString().includes('bg-newSettings')) panel = panel.parentElement;
    return [panel, ...panel.querySelectorAll('*')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > width + 1 && getComputedStyle(el).position !== 'fixed';
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(el.getBoundingClientRect().right)}px`);
  });
  expect(cut).toEqual([]);
});

// Phones had no preview at all: the preview column is hidden below the
// desktop width. A Preview button swaps the editor for it (upstream 48aa7e2c).
test('390 px: the composer shows the preview in place of the editor', async ({ page }) => {
  const text = `Phone preview ${Date.now()}`;
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Create Post' }).first().click();
  await page.getByRole('img', { name: 'bluesky', exact: true }).first().click();
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type(text);
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  await preview.click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ProseMirror').first()).toBeHidden();
  await expect(page.getByText(text, { exact: false }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.ProseMirror').first()).toContainText(text);
});
