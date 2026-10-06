import { expect, Page, test } from '@playwright/test';
import { stateFile } from '../helpers';

// "Add a set" opened the post editor with the channel list it had at that
// moment. Clicked before /integrations/list answered (or with no channel at
// all) the editor rendered nothing: a full-screen blank layer with no close
// button and Escape switched off, stuck until a reload. Found on prod
// 2026-10-06 while proving E2E-05-59. Nothing here saves a set.
test.use({ storageState: stateFile('a') });

const openSetsTab = async (page: Page) => {
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Sets' }).click();
};

test('"Add a set" clicked before the channels have loaded opens a working editor', async ({ page }) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/integrations/list', async (route) => {
    await released;
    await route.continue();
  });

  await openSetsTab(page);
  const click = page.getByRole('button', { name: 'Add a set' }).click();
  // Long enough for a click on an enabled button to have landed.
  await page.waitForTimeout(1500);
  release();
  await click;

  const editor = page.getByRole('dialog', { name: 'Post editor' });
  await expect(editor.getByRole('button', { name: 'Save Set' })).toBeVisible();
  await expect(editor.locator('.ProseMirror').first()).toBeVisible();
});

test('with no channel, "Add a set" says so instead of a blank editor', async ({ page }) => {
  await page.route('**/integrations/list', (route) =>
    route.fulfill({ json: { integrations: [] } })
  );

  await openSetsTab(page);
  await page.getByRole('button', { name: 'Add a set' }).click();

  await expect(page.getByText('Connect a channel first')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Post editor' })).toHaveCount(0);
});
