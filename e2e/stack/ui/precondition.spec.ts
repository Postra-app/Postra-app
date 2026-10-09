import { expect, test } from '@playwright/test';

// Where the 412 from api/trial-reconnect lands: /launches?precondition=true
// explains why the channel was refused and offers to end the trial with a
// payment. Only Cancel is clicked — the other button charges the card.
test('a trial refused a reused channel is told why and offered to pay now', async ({ page }) => {
  await page.goto('/launches?precondition=true');
  await expect(page.getByText('previously connected to another Postra account')).toBeVisible();
  // The payment is confirmed, with its price, on the next screen
  // (E2E-07-41); nothing here says the charge cannot be refunded.
  await expect(page.getByText('confirm the payment on the next screen')).toBeVisible();
  await expect(page.getByText('not be eligible for a refund')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'End my trial' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('previously connected to another Postra account')).toHaveCount(0);
});
