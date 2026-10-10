import { expect, test } from '@playwright/test';

// Upstream's trackers stay asleep until we switch one on (Plan/complience.md:
// no tracker without its own setting and consent). Dub's partner analytics
// was tied to the Stripe key instead, so every signed-in page and the client
// preview loaded https://www.dubcdn.com/analytics/script.js (the CSP reports
// of 2026-10-09), with no Dub account behind it.

for (const path of ['/launches', '/settings']) {
  test(`${path} loads no Dub script`, async ({ page }) => {
    const dub: string[] = [];
    page.on('request', (req) => {
      if (/dubcdn\.com|\.dub\.co\b/.test(req.url())) dub.push(req.url());
    });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(dub).toEqual([]);
  });
}
