import { expect, test } from '@playwright/test';
import { channels } from './publish.helpers';
import { MARKER } from './env';

// Settings, team, webhooks, signatures, public API on production (e2e phase 8,
// S4) with the test account. Everything it creates is temporary and deleted
// in the same test; nothing is published. Manual:
//   pnpm exec playwright test -c e2e/playwright --project setup --project settings

test('every settings read answers 200', async ({ request }) => {
  for (const path of [
    '/api/user/self',
    '/api/settings/team',
    '/api/settings/shortlink',
    '/api/user/email-notifications',
    '/api/webhooks',
    '/api/sets',
    '/api/signatures',
    '/api/notifications',
    '/api/notifications/list',
    '/api/user/approved-apps',
  ]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
  }
});

test('the settings page opens every tab without errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`);
  });
  await page.goto('/settings');
  const tabs = page.getByRole('tablist').getByRole('tab');
  await expect(tabs.first()).toBeVisible();
  const names = await tabs.allInnerTexts();
  expect(names).toContain('Global Settings');
  for (const name of names) {
    const tab = page.getByRole('tab', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  // The open-source link the AGPL asks for.
  await page.getByRole('tab', { name: 'Global Settings', exact: true }).click();
  await expect(page.locator('a[href*="github.com/Postra-app/Postra-app"]').first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('webhooks: internal and plain-http addresses are refused, a real one is kept and removed', async ({ request }) => {
  const [channel] = await channels(request);
  expect(channel, 'a channel in the test organisation').toBeTruthy();
  const body = (url: string) => ({ name: `${MARKER} ${Date.now()}`, url, integrations: [{ id: channel.id }] });

  for (const url of ['http://example.com/hook', 'https://10.0.0.1/hook', 'https://169.254.169.254/latest']) {
    expect((await request.post('/api/webhooks', { data: body(url) })).status(), url).toBe(400);
  }
  const created = await request.post('/api/webhooks', { data: body('https://example.com/hooks/postra-e2e') });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = await created.json();
  try {
    const list: { id: string }[] = await (await request.get('/api/webhooks')).json();
    expect(list.some((w) => w.id === id)).toBe(true);
  } finally {
    expect((await request.delete(`/api/webhooks/${id}`)).status()).toBe(200);
  }
});

test('signatures and email preferences round-trip', async ({ request }) => {
  const created = await request.post('/api/signatures', { data: { content: `<p>${MARKER} signature</p>`, autoAdd: false } });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = await created.json();
  expect((await request.delete(`/api/signatures/${id}`)).status()).toBe(200);

  const before = await (await request.get('/api/user/email-notifications')).json();
  const flipped = { sendSuccessEmails: !before.sendSuccessEmails, sendFailureEmails: before.sendFailureEmails };
  expect((await request.post('/api/user/email-notifications', { data: flipped })).status()).toBeLessThan(300);
  expect(await (await request.get('/api/user/email-notifications')).json()).toMatchObject(flipped);
  await request.post('/api/user/email-notifications', {
    data: { sendSuccessEmails: before.sendSuccessEmails, sendFailureEmails: before.sendFailureEmails },
  });
});

test('the public API answers with the organisation key', async ({ request, playwright, baseURL }) => {
  const self = await (await request.get('/api/user/self')).json();
  expect(self.publicApi, 'an admin sees the API key').toBeTruthy();
  const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Authorization: self.publicApi } });
  try {
    expect((await api.get('/api/public/v1/is-connected')).status()).toBe(200);
    const integrations = await api.get('/api/public/v1/integrations');
    expect(integrations.status()).toBe(200);
    const list: { id: string }[] = await integrations.json();
    expect(list.length).toBeGreaterThan(0);
    expect((await api.get(`/api/public/v1/find-slot/${list[0].id}`)).status()).toBe(200);
    // Without the key: refused.
    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.get('/api/public/v1/integrations')).status()).toBe(401);
    await anon.dispose();
  } finally {
    await api.dispose();
  }
});
