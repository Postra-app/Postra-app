import { expect, test } from '@playwright/test';

// Links into the help page from elsewhere — the Meta checklist's "show me
// how", the channel picker — carry an anchor and must land on that section,
// not at the top of a long page.

test('a link to /help#channel-facebook lands on the Facebook section', async ({ page }) => {
  await page.goto('/help#channel-facebook');
  const section = page.locator('#channel-facebook');
  await expect(section).toBeInViewport();
});

// The checklist of Instagram without a Facebook Page links here (2026-10-27).
test('Help explains both ways to connect Instagram', async ({ page }) => {
  await page.goto('/help#channel-instagram-standalone');
  const section = page.locator('#channel-instagram-standalone');
  await expect(section).toBeInViewport();
  await expect(section).toContainText('Instagram (no Facebook Page)');
  await expect(section).toContainText('no Page to create or link');
  const pageRoute = page.locator('#channel-instagram');
  await expect(pageRoute).toContainText('Which Instagram?');
  await expect(pageRoute).not.toContainText('there is no route around it');
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
// explained in Help before they are promoted.
test('Help explains the Developers tab, the API, SDK, MCP, webhooks and their safety', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByText('Developers', { exact: true }).first()).toBeAttached();
  for (const question of [
    'How do I use the Postra API?',
    'What is the SDK?',
    'How do I connect an AI assistant (MCP)?',
    'What do webhooks do?',
    'Are the API, MCP and webhooks safe to use?',
    'How do I check that a webhook came from Postra?',
  ]) {
    await expect(page.getByText(question, { exact: true }), question).toBeAttached();
  }
});

// The in-app Help keeps its short answers and links to the full user guide on
// postra.co.uk — at the top, and from each section to its page.
test('Help links to the user guide, at the top and from each section', async ({ page }) => {
  await page.goto('/help');
  const guide = page.getByRole('link', { name: 'User guide' });
  await expect(guide).toHaveAttribute('href', 'https://postra.co.uk/docs/guide/');
  await expect(guide).toHaveAttribute('target', '_blank');
  for (const [section, slug] of [
    ['getting-started', 'first-post'],
    ['channels', 'channels'],
    ['tabs', 'app-map'],
    ['studio', 'media-and-ai'],
    ['settings', 'settings'],
    ['faq', 'troubleshooting'],
  ]) {
    await expect(
      page.locator(`#${section}`).getByRole('link', { name: 'Read more in the guide' })
    ).toHaveAttribute('href', `https://postra.co.uk/docs/guide/${slug}/`);
  }
});
