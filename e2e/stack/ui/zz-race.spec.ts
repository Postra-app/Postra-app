import { expect, test } from '@playwright/test';
test('zz send right after opening the agent', async ({ page }) => {
  test.setTimeout(90_000);
  const log: string[] = [];
  page.on('request', (r) => { if (r.url().endsWith('/copilot/agent')) log.push(`${Date.now() % 100000} ${page.url().split('/agents')[1] || '/'} ${(r.postData() || '').slice(0, 40)}`); });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) log.push(`${Date.now() % 100000} NAV ${f.url().split('/agents')[1]}`); });
  await page.goto('/agents');
  const input = page.getByPlaceholder(/Write your (post|message)/);
  await expect(input).toBeVisible();
  const text = `Race ${Date.now()}`;
  await input.fill(text);
  await expect(async () => {
    await input.press('Enter');
    await expect(input).toHaveValue('', { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await page.waitForTimeout(6000);
  log.push('in chat: ' + (await page.locator('.copilotKitMessages').getByText(text).count()));
  console.log(log.join('\n'));
});
