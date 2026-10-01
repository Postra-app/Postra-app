import { expect, test } from '@playwright/test';
import { signedIn } from '../helpers';
import { USERS } from '../seed';

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

test("a tile's hint does not hang over the dialog its click opens", async ({ page }) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Add Channel' }).click();
  const tile = page.getByText('Instagram', { exact: false }).filter({ hasText: 'Facebook Business' });
  await tile.hover();
  const hint = page.locator('#tooltip');
  await expect(hint).toBeVisible();
  await tile.click();
  await expect(page.getByText('Before you connect Instagram')).toBeVisible();
  await expect(hint).toBeHidden();
});

test('removing a time slot removes that slot, not its neighbour', async ({ page }) => {
  // The list is sorted on screen, the stored array is not (a new slot is
  // appended): the bin next to a slot added later removed another one.
  const api = await signedIn('a');
  const slots = async () => {
    const list = await (await api.get('/integrations/list')).json();
    return Object.fromEntries(
      list.integrations.map((i: { id: string; time: { time: number }[] }) => [
        i.id,
        i.time.map((s) => s.time).sort((x, y) => x - y),
      ])
    );
  };
  const before = await slots();

  await page.goto('/launches');
  await page.getByRole('button', { name: 'Channel options' }).first().click();
  await page.getByText('Edit Time Slots', { exact: true }).click();
  // 05:00 in London (04:00 UTC) sits mid-list on screen but is stored last:
  // the old bin removed the slot at its on-screen position in the stored
  // array — a different slot.
  await page.getByRole('combobox').nth(0).selectOption('05');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Remove 05:00' }).click();
  await page.getByRole('button', { name: 'Yes, delete it!' }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();

  await expect.poll(slots).toEqual(before);
  await api.dispose();
});
