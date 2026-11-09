import { expect, Page, test } from '@playwright/test';

// The nonce policy (apps/frontend/src/csp.ts) is enforced on every page,
// beside the one nginx sends (the stack proxy serves it too): the main
// screens must not trip either, or they break. A violation here is mostly a
// script without the page's nonce.

const watch = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as any).__violations.push(
        `${e.disposition} ${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`
      );
    });
  });
};

const visit = async (page: Page, path: string) => {
  const res = await page.goto(path);
  const policies = ((await res?.headersArray()) ?? [])
    .filter((h) => h.name.toLowerCase() === 'content-security-policy')
    .map((h) => h.value);
  expect(policies.some((p) => /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(p)), path).toBe(true);
  expect(res?.headers()['content-security-policy-report-only'], path).toBeUndefined();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => (window as any).__violations), path).toEqual([]);
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

// Enforced, not only reported: a script in the page's HTML without the
// nonce (what stored XSS would put there) does not run, and the page still
// works. Injected into the HTML on purpose: a script added from a script
// (Playwright's addScriptTag) is trusted by 'strict-dynamic' by design.
test('a script without the nonce does not run', async ({ page }) => {
  await page.route('**/launches', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(
      '</body>',
      '<script>window.__ranWithoutNonce = true;</script></body>'
    );
    await route.fulfill({ response: res, body });
  });
  const blocked: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as any).__blocked = [...((window as any).__blocked || []), `${e.disposition} ${e.effectiveDirective} ${e.blockedURI}`]
    );
  });
  await page.goto('/launches');
  await page.waitForLoadState('networkidle');
  blocked.push(...(await page.evaluate(() => (window as any).__blocked || [])));
  expect(await page.evaluate(() => (window as any).__ranWithoutNonce)).toBeUndefined();
  expect(blocked).toEqual([expect.stringMatching(/^enforce script-src-elem inline$/)]);
  await expect(page.getByRole('button', { name: /Create Post/i }).first()).toBeVisible();
});
