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
