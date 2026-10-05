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
