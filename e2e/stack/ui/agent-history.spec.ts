import { expect, test } from '@playwright/test';
import { watchForErrors } from './ui-helpers';

// Leaving a chat and coming back showed only the greeting. The history is
// fetched from /copilot/<thread>/list, but CopilotKit also asks the runtime for
// the thread (agent/connect; loadAgentState before 1.50) and replaces the
// messages with what that returns — nothing for a Mastra agent. Whoever answers
// last wins; the route below makes that request answer last, every time, the
// way production did.

const ANSWER = 'Stack AI answer.';

test('a chat opened again shows its messages, and they stay', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchForErrors(page);
  await page.route('**/api/copilot/agent', async (route) => {
    if ((route.request().postData() || '').includes('"agent/connect"')) {
      await new Promise((r) => setTimeout(r, 1_500));
    }
    await route.continue();
  });

  await page.goto('/agents');
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  const chatUrl = page.url();
  const question = `History check ${Date.now()}`;
  const input = page.getByPlaceholder(/Write your (post|message)/);
  // The chat takes no message while it connects to the thread (held back
  // 1.5 s above), as for a person typing straight away.
  await expect(page.locator('[data-copilotkit-in-progress="false"]')).toBeVisible({ timeout: 15_000 });
  await input.fill(question);
  await input.press('Enter');
  await expect(page.getByText(ANSWER).first()).toBeVisible({ timeout: 30_000 });

  await page.goto('/agents');
  await expect(page).not.toHaveURL(chatUrl);
  await page.goto(chatUrl);

  await expect(page.getByText(question)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(ANSWER).first()).toBeVisible();
  // Still there once every load has answered.
  await page.waitForTimeout(3_000);
  await expect(page.getByText(question)).toBeVisible();
  await expect(page.getByText(ANSWER).first()).toBeVisible();
  expect(problems).toEqual([]);
});
