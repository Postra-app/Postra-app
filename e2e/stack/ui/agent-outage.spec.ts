import { expect, test } from '@playwright/test';

// OpenAI down while the assistant answers (fake-openai.mjs /__outage: every
// model call carrying the marker answers 500 after the SDK's retries). The
// person who asked must be told, not left with a message and no reply.
const FAKE = 'http://localhost:58090';
const OUTAGE = 'stack-agent-outage-probe';

test('the assistant says so when OpenAI is down', async ({ page, request }) => {
  test.setTimeout(120_000);
  await request.post(`${FAKE}/__outage`, { data: { match: OUTAGE, on: true } });
  try {
    const connected = page.waitForResponse(
      (r) => r.url().endsWith('/copilot/agent') && (r.request().postData() || '').includes('"agent/connect"')
    );
    await page.goto('/agents');
    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
    await connected;
    await expect(page.locator('[data-copilotkit-in-progress="false"]')).toBeVisible();
    const input = page.getByPlaceholder(/Write your (post|message)/);
    await input.fill(`${OUTAGE} plan one post for tomorrow`);
    await input.press('Enter');
    // The run ends (no endless spinner) and the chat says why.
    await expect(page.locator('[data-copilotkit-in-progress="false"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('AI is unavailable right now. Please try again in a few minutes.')).toBeVisible({ timeout: 15_000 });
  } finally {
    await request.post(`${FAKE}/__outage`, { data: { match: OUTAGE, on: false } });
  }
});
