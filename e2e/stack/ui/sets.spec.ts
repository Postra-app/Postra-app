import { expect, Page, test } from '@playwright/test';
import { signedIn, stateFile } from '../helpers';
import { USERS } from '../seed';
import { quietSlot } from './ui-helpers';

// "Add a set" opened the post editor with the channel list it had at that
// moment. Clicked before /integrations/list answered (or with no channel at
// all) the editor rendered nothing: a full-screen blank layer with no close
// button and Escape switched off, stuck until a reload. Found on prod
// 2026-10-06 while proving E2E-05-59. Nothing here saves a set.
test.use({ storageState: stateFile('a') });

const openSetsTab = async (page: Page) => {
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Sets' }).click();
};

test('"Add a set" clicked before the channels have loaded opens a working editor', async ({ page }) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/integrations/list', async (route) => {
    await released;
    await route.continue();
  });

  await openSetsTab(page);
  const click = page.getByRole('button', { name: 'Add a set' }).click();
  // Long enough for a click on an enabled button to have landed.
  await page.waitForTimeout(1500);
  release();
  await click;

  const editor = page.getByRole('dialog', { name: 'Post editor' });
  await expect(editor.getByRole('button', { name: 'Save Set' })).toBeVisible();
  await expect(editor.locator('.ProseMirror').first()).toBeVisible();
});

test('with no channel, "Add a set" says so instead of a blank editor', async ({ page }) => {
  await page.route('**/integrations/list', (route) =>
    route.fulfill({ json: { integrations: [] } })
  );

  await openSetsTab(page);
  await page.getByRole('button', { name: 'Add a set' }).click();

  await expect(page.getByText('Connect a channel first')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Post editor' })).toHaveCount(0);
});

test('a set keeps each channel’s own text (E2E-05-92)', async ({ page }) => {
  // The editor opened every channel of a set with the first channel's text.
  const api = await signedIn('a');
  const tag = `[stack ui] set ${Date.now()}`;
  const content = {
    type: 'draft',
    shortLink: false,
    date: quietSlot(5).toISOString(),
    tags: [],
    posts: [
      { integration: { id: USERS.a.channel.id }, value: [{ content: `<p>${tag} bluesky</p>`, image: [] }], settings: { __type: 'bluesky' } },
      { integration: { id: USERS.a.mastodon.id }, value: [{ content: `<p>${tag} mastodon</p>`, image: [] }], settings: { __type: 'mastodon' } },
    ],
  };
  const saved = await api.post('/sets', { data: { name: tag, content: JSON.stringify(content) } });
  expect(saved.ok(), await saved.text()).toBe(true);
  try {
    await openSetsTab(page);
    await page.getByText(tag, { exact: true }).locator('xpath=following-sibling::div[1]').getByRole('button', { name: 'Edit' }).click();
    const editor = page.getByRole('dialog', { name: 'Post editor' });
    const mastodon = editor.getByRole('button', { name: USERS.a.mastodon.name, exact: true });
    await mastodon.focus();
    await page.keyboard.press('Enter');
    await expect(mastodon).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.getByRole('textbox').first()).toContainText(`${tag} mastodon`);

    const bluesky = editor.getByRole('button', { name: USERS.a.channel.name, exact: true });
    await bluesky.focus();
    await page.keyboard.press('Enter');
    await expect(editor.getByRole('textbox').first()).toContainText(`${tag} bluesky`);
  } finally {
    const sets: { id: string; name: string }[] = await (await api.get('/sets')).json();
    for (const set of sets.filter((s) => s.name === tag)) {
      await api.delete(`/sets/${set.id}`);
    }
    await api.dispose();
  }
});
