import { expect, test } from '@playwright/test';

// Production's policy (var/docker/nginx.conf) has no 'unsafe-eval'. zod 4
// probes eval before compiling a parser, and with CopilotKit parsing in the
// app shell that probe was a violation report on every page. The stack proxy
// serves nginx.conf's policy on every page (e2e/stack/proxy.mjs).

test('the app shell makes no eval the policy blocks', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    (window as any).__violations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as any).__violations.push(`${e.effectiveDirective} ${e.blockedURI}`)
    );
  });
  for (const path of ['/launches', '/agents', '/settings']) {
    await page.goto(path);
    await page.waitForTimeout(2_500);
    expect(await page.evaluate(() => (window as any).__violations), path).toEqual([]);
  }
});
