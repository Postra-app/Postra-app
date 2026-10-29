import { expect, test } from '@playwright/test';

// A run the server refuses (another chat of the organisation still answering:
// 429; the monthly limit: 402) left the message hanging with no reply and no
// word why: CopilotKit 1.83 reports it only to the console.
test('a refused agent run says why', async ({ page }) => {
  test.setTimeout(60_000);
  const reason = 'The AI assistant is already answering in another chat. Wait for it to finish, then try again.';
  await page.route('**/api/copilot/agent', async (route) => {
    if ((route.request().postData() || '').includes('"agent/run"')) {
      await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: reason }) });
      return;
    }
    await route.continue();
  });
  const connected = page.waitForResponse(
    (r) => r.url().endsWith('/copilot/agent') && (r.request().postData() || '').includes('"agent/connect"')
  );
  await page.goto('/agents');
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  await connected;
  await expect(page.locator('[data-copilotkit-in-progress="false"]')).toBeVisible();
  const input = page.getByPlaceholder(/Write your (post|message)/);
  await input.fill(`Refused ${Date.now()}`);
  await input.press('Enter');
  await expect(page.getByText(reason)).toHaveCount(1, { timeout: 15_000 });
});
