import { expect, test } from '@playwright/test';

// Settings → Developers was hidden until @postra/node was on npm. What it shows
// has to exist: it used to send customers to two docs domains that never
// resolved, an n8n package nobody published and `npm install -g postra`, a
// name anyone could claim and have every Postra customer install globally.

test('Settings → Developers: API key, the SDK and MCP, and nothing that does not exist', async ({
  page,
}) => {
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Developers' }).click();

  await expect(page.getByText('npm install @postra/node', { exact: true })).toBeVisible();
  await expect(page.getByText('MCP Client Configuration')).toBeVisible();
  await expect(page.getByRole('link', { name: 'npm package' })).toHaveAttribute(
    'href',
    'https://www.npmjs.com/package/@postra/node'
  );

  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs.filter((h) => /docs\.postra|n8n-nodes|postra-agent/.test(h))).toEqual([]);
  await expect(page.getByText(/npm install -g|skills add/)).toHaveCount(0);

  // The key in the snippet stays masked until revealed.
  const snippet = page.locator('pre', { hasText: "new Postra('" });
  await expect(snippet).toContainText("new Postra('****");

  // The OAuth app's "Docs" button opened docs.postra.co.uk, which never
  // existed; the guide now lives in this repository.
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Docs', exact: true })).toHaveAttribute(
    'href',
    'https://github.com/Postra-app/Postra-app/blob/main/docs/public-api/oauth.md'
  );
});

// ChatGPT and Claude used to get the API key inside the server address
// (https://…/mcp/<key>): in every log on the way, full access, and cutting one
// assistant off meant rotating the key for everything. They sign in by OAuth
// now (dynamic client registration): the address carries no key.
test('Remote servers (ChatGPT, Claude) get the OAuth address, never the API key', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Developers' }).click();
  await page.getByRole('button', { name: 'Remote servers (ChatGPT, Claude)' }).click();
  await expect(page.getByText(/\/api\/mcp-oauth$/)).toBeVisible();
  await expect(page.getByText(/sign in to Postra and approve/i)).toBeVisible();
  await expect(page.getByText(/\/mcp\/[*\w]{8,}/)).toHaveCount(0);
});
