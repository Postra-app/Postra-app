import { expect, test } from '@playwright/test';

// Where the 412 from api/trial-reconnect lands: /launches?precondition=true
// explains why the channel was refused and offers to end the trial with a
// payment. Only Cancel is clicked — the other button charges the card.
test('a trial refused a reused channel is told why and offered to pay now', async ({ page }) => {
  await page.goto('/launches?precondition=true');
  await expect(page.getByText('previously connected to another Postra account')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fast-forward — charge me now' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('previously connected to another Postra account')).toHaveCount(0);
});
