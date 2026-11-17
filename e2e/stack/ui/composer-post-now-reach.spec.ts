import { expect, test } from '@playwright/test';
import { openComposer } from './ui-helpers';

// "Post now" showed only while a mouse hovered the button: from the keyboard
// it stayed display:none, and on a touch screen a tap on the button scheduled
// the post at once. The arrow is now a button of its own that opens it, and
// keyboard focus inside the group shows it too. Nothing is published here.
test('Post now shows when the button has keyboard focus', async ({ page }) => {
  await openComposer(page, 'mastodon', `[stack ui] post now keys ${Date.now()}`);
  const postNow = page.getByTestId('post-now');
  await page.mouse.move(5, 5);
  await expect(postNow).toBeHidden();

  await page.getByRole('button', { name: 'Add to calendar' }).focus();
  await expect(postNow).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'More publishing options' })).toBeFocused();
  await expect(postNow).toBeVisible();
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test('tapping the arrow opens Post now instead of scheduling', async ({ page }) => {
    await openComposer(page, 'mastodon', `[stack ui] post now tap ${Date.now()}`);
    const postNow = page.getByTestId('post-now');
    const arrow = page.getByRole('button', { name: 'More publishing options' });
    await page.mouse.move(5, 5);
    await page.getByRole('textbox').first().focus();
    await expect(postNow).toBeHidden();
    await expect(arrow).toHaveAttribute('aria-expanded', 'false');

    await arrow.tap();
    await expect(arrow).toHaveAttribute('aria-expanded', 'true');
    await expect(postNow).toBeVisible();
    // The composer is still open: nothing was scheduled.
    await expect(page.getByRole('button', { name: 'Add to calendar' })).toBeVisible();
  });
});
