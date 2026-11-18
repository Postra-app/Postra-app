import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Slack and Discord channels and WordPress post types come from the platform.
// While the list loaded, or when it did not come, the settings panel was
// empty and saving failed with "channel should not be null or undefined".
test.use({ storageState: { cookies: [], origins: [] } });

const cases = [
  { provider: 'slack', failed: 'Slack did not send your channels', refresh: 'Refresh channels', label: 'Select channel' },
  { provider: 'discord', failed: 'Discord did not send your channels', refresh: 'Refresh channels', label: 'Select channel' },
  { provider: 'wordpress', failed: 'WordPress did not send its post types', refresh: 'Refresh post types', label: 'Select type' },
];

for (const c of cases) {
  test(`${c.provider}: the settings say when the list did not come, and refresh brings it`, async ({ page, context }) => {
    const prisma = database();
    const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 15, channels: 1, provider: c.provider });
    try {
      await context.addCookies((await org.api.storageState()).cookies);
      let answer: 'false' | 'list' = 'false';
      let release: () => void = () => undefined;
      const held = new Promise<void>((r) => (release = r));
      let calls = 0;
      await page.route('**/api/integrations/function', async (route) => {
        calls += 1;
        // The first answer is held back, so the panel is seen while it waits.
        if (calls === 1) await held;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: answer === 'false' ? 'false' : JSON.stringify([{ id: 'c1', name: 'general' }]),
        });
      });
      await page.goto('/launches');
      await page.getByRole('button', { name: 'Create Post' }).click();
      await page.getByRole('img', { name: c.provider, exact: true }).first().click();
      await page.getByRole('button', { name: `Throwaway ${c.provider} 0`, exact: true }).click();
      await page.getByText(`Throwaway ${c.provider} 0 Settings`).click();

      await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible();
      release();
      await expect(page.getByText(c.failed)).toBeVisible();

      answer = 'list';
      await page.getByRole('button', { name: c.refresh }).click();
      const select = page.getByRole('combobox', { name: c.label });
      await expect(select).toBeVisible();
      await select.selectOption('c1');
      await expect(select).toHaveValue('c1');
    } finally {
      await org.remove();
      await prisma.$disconnect();
    }
  });
}
