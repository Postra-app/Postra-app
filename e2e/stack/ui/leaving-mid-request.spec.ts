import { expect, test } from '@playwright/test';

// Leaving a page cancels its requests still in flight. Safari reports each as
// "TypeError: Load failed", and the data loader logged it as a load failure —
// a console error, so a Sentry event, on every full navigation taken while
// the page was still loading. Nothing had failed.
test('leaving a page while it still loads logs no load failure @safari', async ({ page }) => {
  const logged: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('[Postra:swr]')) logged.push(msg.text());
  });
  // The first page's account load is held until after it has been left.
  let first = true;
  let asked!: () => void;
  const pending = new Promise<void>((r) => (asked = r));
  await page.route('**/api/user/self', async (route) => {
    if (!first) return route.continue();
    first = false;
    asked();
    await new Promise((r) => setTimeout(r, 4_000));
    await route.continue().catch(() => undefined);
  });
  await page.goto('/media', { waitUntil: 'commit' });
  await pending;
  await page.goto('/launches');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);
  expect(logged).toEqual([]);
});

// The other half: on a page that stays, a request that never lands is still
// reported, a moment later, with the connection message.
test('a request that never lands on a page that stays is still reported @safari', async ({ page }) => {
  const logged: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('[Postra:swr]')) logged.push(msg.text());
  });
  await page.route('**/api/integrations/list', (route) => route.abort('failed'));
  await page.goto('/launches');
  await expect(page.getByText("Can't reach the server", { exact: false })).toBeVisible({ timeout: 15_000 });
  expect(logged.length).toBeGreaterThan(0);
});
