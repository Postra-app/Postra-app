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
