import { expect, Page, test } from '@playwright/test';

// The nonce policy (apps/frontend/src/csp.ts) runs report-only beside the
// enforced one: every page carries it, and the main screens must not trip it,
// or switching it to enforced would break them. A violation here is a script
// without the page's nonce.

const watch = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__reportOnly = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      if (e.disposition === 'report') {
        (window as any).__reportOnly.push(
          `${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`
        );
      }
    });
  });
};

const visit = async (page: Page, path: string) => {
  const res = await page.goto(path);
  const header = res?.headers()['content-security-policy-report-only'] ?? '';
  expect(header, path).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => (window as any).__reportOnly), path).toEqual([]);
};

test('signed-in screens run no script without the nonce', async ({ page }) => {
  test.setTimeout(180_000);
  await watch(page);
  for (const path of [
    '/launches',
    '/media',
    '/analytics',
    '/agents',
    '/autopost',
    '/plugs',
    '/studio',
    '/settings',
    '/billing',
    '/help',
    '/no-such-page',
  ]) {
    await visit(page, path);
  }
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login and sign-up run no script without the nonce', async ({ page }) => {
    await watch(page);
    for (const path of ['/auth/login', '/auth', '/no-such-page']) {
      await visit(page, path);
    }
  });
});
