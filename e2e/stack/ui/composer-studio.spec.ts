import { expect, test } from '@playwright/test';
import { openComposer, watchForErrors } from './ui-helpers';

// P5 #3: composer → Studio → "Use in post" puts the graphic in the post. The
// toolbar buttons (Studio, Insert Media) were clickable divs the keyboard
// never reached, so this walks in from the keyboard.
test.use({ viewport: { width: 1440, height: 900 } });

test('composer → Studio from the keyboard → Use in post attaches the graphic', async ({ page }) => {
  const problems = watchForErrors(page);
  await openComposer(page, 'bluesky', 'A graphic made in Studio, straight into the post');

  const editor = page.getByRole('dialog', { name: 'Post editor' });
  await expect(editor.getByRole('button', { name: 'Insert Media' })).toBeVisible();
  await editor.getByRole('button', { name: 'Studio', exact: true }).focus();
  await page.keyboard.press('Enter');

  await page.getByText('Blank canvas').click();
  const uploaded = page.waitForResponse(
    (res) => res.url().includes('/media/upload-simple') && res.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Use in post' }).click();
  expect((await uploaded).status()).toBe(201);

  // Studio closes and the post carries one picture.
  await expect(page.getByRole('button', { name: 'Use in post' })).toHaveCount(0);
  await expect(editor.locator('img[src*="/uploads/"], img[src*="cdn"]').first()).toBeVisible();
  expect(problems).toEqual([]);
});
