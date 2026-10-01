import { expect, test } from '@playwright/test';

// The UK landing (postra.co.uk). TikTok rejected the app three times over
// dead buttons on it, found by hand weeks later; this finds them the night
// they break. Read-only: no sign-in, nothing submitted.

const APP = 'https://app.postra.pl';

test('every link to the app leads to a working sign-in or sign-up page', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const hrefs = await page
    .locator(`a[href^="${APP}"]`)
    .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
  const unique = [...new Set(hrefs)];
  expect(unique.length, 'calls to action pointing at the app').toBeGreaterThan(0);

  for (const href of unique) {
    expect(new URL(href).pathname, href).toMatch(/^\/auth(\/register|\/login)?\/?$/);
    // While sign-ups are frozen /auth/register redirects to /auth/login, so
    // follow redirects and require a sign-in or sign-up page at the end.
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
    expect(new URL(res.url()).pathname, `${href} lands on`).toMatch(/^\/auth/);
  }
});

test('legal pages answer and have a heading', async ({ page }) => {
  for (const path of ['/terms', '/privacy', '/data-deletion']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.locator('h1').first(), path).toBeVisible();
  }
});

test('the footer links the legal pages and the contact address', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('footer');
  await expect(footer.locator('a[href="/terms"]')).toHaveCount(1);
  await expect(footer.locator('a[href="/privacy"]')).toHaveCount(1);
  await expect(footer.locator('a[href="mailto:hello@postra.co.uk"]')).toHaveCount(1);
});

test('the home page loads without errors or broken resources', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`${res.status()} ${res.url()}`);
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  expect(problems).toEqual([]);
});

test('pricing does not promise LinkedIn Company Pages', async ({ page }) => {
  // Company Pages need LinkedIn's Standard Tier, which we do not have yet
  // (Plan/app_review.md). A landing redeploy from an old copy must not bring
  // the promise back.
  await page.goto('/');
  await expect(page.locator('body')).not.toContainText(/company pages?/i);
});
