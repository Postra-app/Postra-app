import { expect, test } from '@playwright/test';
import { stateFile } from '../helpers';
import { openComposer } from './ui-helpers';

// The composer's close control was a bare icon: no accessible name, not
// reachable from the keyboard, and Escape is off in this modal. Found on prod
// 2026-10-06 while proving E2E-05-58.
test.use({ storageState: stateFile('a') });

test('the composer has a named Close button that asks before discarding', async ({ page }) => {
  await openComposer(page, 'bluesky', `Close button ${Date.now()}`);
  const editor = page.getByRole('dialog', { name: 'Post editor' });

  const close = editor.getByRole('button', { name: 'Close', exact: true });
  await close.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Yes, close it!' }).click();

  await expect(editor).toHaveCount(0);
});
