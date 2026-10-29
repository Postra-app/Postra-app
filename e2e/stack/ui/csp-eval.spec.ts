import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Production's policy (var/docker/nginx.conf) has no 'unsafe-eval'. zod 4
// probes eval before compiling a parser, and with CopilotKit parsing in the
// app shell that probe was a violation report on every page. The stack serves
// no policy, so this test adds production's to every page it opens.
const policy = (() => {
  const conf = readFileSync(`${__dirname}/../../../var/docker/nginx.conf`, 'utf8');
  const match = conf.match(/add_header Content-Security-Policy "([^"]+)"/);
  if (!match) throw new Error('no Content-Security-Policy in nginx.conf');
  return match[1];
})();

test('the app shell makes no eval the policy blocks', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } });
  });
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
