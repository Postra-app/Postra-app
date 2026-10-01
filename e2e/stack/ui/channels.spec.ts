import { expect, test } from '@playwright/test';

// Adding a channel. Meta platforms first show a checklist; "Not yet — show me
// how" opens help, and the customer comes back and continues. That second
// try used to hit a dead "Done — continue": the checklist stayed on screen
// after "Not yet" with its answer already given.

test('Meta checklist: "Not yet" closes it, and a second try reaches Meta', async ({
  page,
  context,
}) => {
  // Leaving for facebook.com is the end of our part; stop there.
  let reachedMeta = '';
  await context.route(/facebook\.com/, (route) => {
    reachedMeta = route.request().url();
    return route.abort();
  });

  await page.goto('/launches');
  await page.getByRole('button', { name: 'Add Channel' }).click();
  await page.getByText('Facebook Page', { exact: true }).click();
  await expect(page.getByText('Before you connect Facebook')).toBeVisible();

  const help = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Not yet — show me how' }).click();
  await (await help).close();
  await expect(page.getByText('Before you connect Facebook')).toBeHidden();

  // The picker is still there; try again and continue.
  await page.getByText('Facebook Page', { exact: true }).click();
  await page.getByRole('button', { name: 'Done — continue' }).click();
  await expect.poll(() => reachedMeta, { timeout: 15_000 }).toContain('facebook.com');
});

test('declining on the platform says so in plain words, and adds nothing', async ({ page }) => {
  await page.goto(
    '/integrations/social/mastodon?error=access_denied&error_description=The+resource+owner+or+authorization+server+denied+the+request.&state=declined'
  );
  await expect(page.getByText('You declined the connection request.')).toBeVisible();
  await expect(page.getByText(/resource owner/)).toHaveCount(0);
});

test('a forged or expired callback shows why it failed', async ({ page }) => {
  // The backend answers 400 "This connection attempt has expired…"; the page
  // read that body twice and showed only "Could not add provider".
  await page.goto('/integrations/social/mastodon?code=forged&state=unknown-state');
  await expect(page.getByText(/connection attempt has expired/)).toBeVisible();
});

test("the channel menu opens from the keyboard and its items are readable", async ({ page }) => {
  // The trigger was a div with onClick: no keyboard, no name. And
  // text-textColor/78 generated no CSS, so the items took the body's grey
  // rgb(69, 69, 69) — about 1.9:1 against the dark panel.
  await page.goto('/launches');
  const trigger = page.getByRole('button', { name: 'Channel options' }).first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const item = page.getByText('Edit Time Slots', { exact: true });
  await expect(item).toBeVisible();
  const color = await item.evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe('rgb(69, 69, 69)');
  expect(color).toMatch(/rgba?\(255, 255, 255/);
});
