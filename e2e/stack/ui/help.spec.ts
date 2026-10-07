import { expect, test } from '@playwright/test';

// Links into the help page from elsewhere — the Meta checklist's "show me
// how", the channel picker — carry an anchor and must land on that section,
// not at the top of a long page.

test('a link to /help#channel-facebook lands on the Facebook section', async ({ page }) => {
  await page.goto('/help#channel-facebook');
  const section = page.locator('#channel-facebook');
  await expect(section).toBeInViewport();
});

test('every channel in the help contents has a section', async ({ page }) => {
  await page.goto('/help');
  await expect(page.locator('a[href^="#channel-"]').first()).toBeVisible();
  const links = await page.locator('a[href^="#channel-"]').evaluateAll((as) =>
    as.map((a) => a.getAttribute('href')!.slice(1))
  );
  expect(links.length).toBeGreaterThanOrEqual(12);
  for (const id of links) {
    await expect(page.locator(`#${id}`), id).toHaveCount(1);
  }
});

// The Developers tab (API key, MCP, SDK, OAuth apps) and webhooks are
// explained in Help before they are promoted (E2E-11-12).
test('Help explains the Developers tab, the API, SDK, MCP, webhooks and their safety', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByText('Developers', { exact: true }).first()).toBeAttached();
  for (const question of [
    'How do I use the Postra API?',
    'What is the SDK?',
    'How do I connect an AI assistant (MCP)?',
    'What do webhooks do?',
    'Are the API, MCP and webhooks safe to use?',
  ]) {
    await expect(page.getByText(question, { exact: true }), question).toBeAttached();
  }
});
