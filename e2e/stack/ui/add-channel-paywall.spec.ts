import { expect, test } from '@playwright/test';
import { stateFile } from '../helpers';

// Starter (organisation B) picks a Pro platform (YouTube): the payment dialog says why;
// Cancel leaves the channel picker open. It used to read the 402 body for the
// dialog and then again for the picker — "body already used", a crash
// (upstream d727ac0b, 971aa369, c033aff5).
test.use({ storageState: stateFile('b') });

test('Cancel on the payment dialog keeps the channel picker, without an error', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && /body|already|json/i.test(m.text()) && pageErrors.push(m.text()));

  await page.goto('/launches');
  await page.getByRole('button', { name: 'Add Channel' }).click();
  const response = page.waitForResponse((r) => r.url().includes('/integrations/social/youtube'));
  const youtube = page.locator('.launches-provider-card', { hasText: 'YouTube' });
  await youtube.click();
  expect((await response).status()).toBe(402);

  await page.getByRole('button', { name: 'No, cancel!' }).click();
  await expect(youtube).toBeVisible();
  await page.waitForTimeout(500);
  expect(pageErrors).toEqual([]);
});
