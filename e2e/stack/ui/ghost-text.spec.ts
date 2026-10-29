import { expect, test } from '@playwright/test';

// The signature editor shows the suggestion as ghost text while typing. With
// CopilotKit 1.83 the stock textarea sent no request at all and nothing
// appeared, with no error anywhere.
test('typing in the signature editor shows a suggestion', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/settings');
  await page.getByRole('tab', { name: /signatures/i }).click();
  await page.getByRole('button', { name: /add( a)? signature/i }).click();
  const editor = page.locator('[contenteditable="true"]').last();
  await expect(editor).toBeVisible();
  const asked = page.waitForResponse(
    (r) => r.url().endsWith('/copilot/autocomplete') && r.request().method() === 'POST'
  );
  await editor.click();
  await page.keyboard.type('Thanks for reading! Plan your next post with', { delay: 30 });
  const res = await asked;
  expect(res.status()).toBe(201);
  expect(JSON.parse(res.request().postData() || '{}').surface).toBe('signature');
  await expect(editor.getByText('Stack AI answer.')).toBeVisible();
});
