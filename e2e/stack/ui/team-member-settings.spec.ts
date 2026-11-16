import { expect, test } from '@playwright/test';
import { stateFile } from '../helpers';

// A team member (role USER) in a Business organisation. Every Settings tab
// they are shown has to work for them: a tab whose content the API refuses
// (admin-only routes) is a dead end, not a permission.

test.use({ storageState: stateFile('c-user') });

test('Settings as a team member: every tab shown opens without a refused request', async ({
  page,
}) => {
  const refused: string[] = [];
  page.on('response', (res) => {
    // The AI assistant answers 402 once the organisation's AI budget is
    // spent, which other UI tests in org C do first: a plan answer, not a
    // tab that is refused.
    if (res.url().includes('/copilot/')) return;
    if (res.url().includes('/api/') || res.url().includes(':53000/')) {
      if ([401, 402, 403].includes(res.status())) {
        refused.push(`${res.status()} ${res.request().method()} ${new URL(res.url()).pathname}`);
      }
    }
  });

  await page.goto('/settings');
  const tabs = page.getByRole('tab');
  await expect(tabs.first()).toBeVisible();
  const names = await tabs.allInnerTexts();

  // Admin-only: outgoing data and API keys.
  expect(names).not.toContain('Webhooks');
  expect(names).not.toContain('Developers');

  for (const name of names) {
    await page.getByRole('tab', { name, exact: true }).click();
    await page.waitForLoadState('networkidle');
  }
  expect(refused).toEqual([]);
});

// A member saw Auto Post in the menu and, on the page, every feed with its
// Edit and Delete buttons, though only an admin may change feeds. And someone
// who signed up through an invitation was greeted with "Connect your
// channels", where every tile answered "you do not have permission".
test('a team member has no Auto Post and no "connect your channels" welcome', async ({ page }) => {
  await page.goto('/launches');
  await expect(page.getByRole('button', { name: 'Create Post' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Auto Post' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Media' }).first()).toBeVisible();

  await page.goto('/autopost');
  await page.waitForURL(/\/launches/);
  await expect(page.getByText('Add an Auto Post feed')).toHaveCount(0);

  await page.goto('/launches?onboarding=true');
  await page.waitForURL((url) => url.pathname === '/launches' && !url.search.includes('onboarding'));
  await expect(page.getByText('Connect Your Channels')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Post' })).toBeVisible();
});
