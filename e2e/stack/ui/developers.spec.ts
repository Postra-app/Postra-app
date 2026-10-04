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
});
