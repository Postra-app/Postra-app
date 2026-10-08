import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';
import { openComposer, quietSlot, weekOf } from './ui-helpers';

// Group schedules (upstream a194e3f4 + 003a77eb): a post saved for several
// channels opens in the editor with all of them, each with its own text, and
// a delete asks whether to remove it from all channels or only the one in
// view.

const BLUESKY = USERS.a.channel;
const MASTODON = USERS.a.mastodon;

const saveForTwo = async (api: APIRequestContext, slot: Date, tag: string) => {
  const res = await api.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: slot.toISOString(),
      tags: [],
      posts: [
        { integration: { id: BLUESKY.id }, value: [{ content: `${tag} bluesky`, image: [] }], settings: { __type: 'bluesky' } },
        { integration: { id: MASTODON.id }, value: [{ content: `${tag} mastodon`, image: [] }], settings: { __type: 'mastodon' } },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
};

const openFromCalendar = async (page: Page, slot: Date, channel: string, text: string) => {
  await page.goto(weekOf(slot));
  await page.getByRole('button', { name: `Open post: ${channel}` }).filter({ hasText: text }).click();
  return page.getByRole('dialog', { name: 'Post editor' });
};

const cleanUp = async (api: APIRequestContext, tag: string) => {
  for (const post of (await listPosts(api)).filter((p) => p.content.includes(tag))) {
    await api.delete(`/posts/${post.group}`);
  }
};

test('a post saved for two channels opens with both, and each keeps its own text', async ({ page }) => {
  test.setTimeout(90_000);
  const api = await signedIn('a');
  const tag = `[stack ui] group ${Date.now()}`;
  const slot = quietSlot(3);
  try {
    await saveForTwo(api, slot, tag);
    const editor = await openFromCalendar(page, slot, BLUESKY.name, `${tag} bluesky`);

    await expect(editor.getByRole('button', { name: BLUESKY.name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    const mastodon = editor.getByRole('button', { name: MASTODON.name, exact: true });
    await mastodon.focus();
    await page.keyboard.press('Enter');
    await expect(mastodon).toHaveAttribute('aria-pressed', 'true');
    const text = editor.getByRole('textbox').first();
    await expect(text).toContainText(`${tag} mastodon`);
    await text.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' edited');

    await editor.getByRole('button', { name: 'Save as Draft' }).click();
    await expect(editor).toBeHidden();

    const posts = (await listPosts(api)).filter((p) => p.content.includes(tag));
    expect(posts).toHaveLength(2);
    expect(posts.find((p) => p.content.includes('mastodon'))!.content).toContain('edited');
    expect(posts.find((p) => p.content.includes('bluesky'))!.content).not.toContain('edited');
  } finally {
    await cleanUp(api, tag);
    await api.dispose();
  }
});

test('deleting a post saved for two channels can remove it from only one', async ({ page }) => {
  test.setTimeout(90_000);
  const api = await signedIn('a');
  const tag = `[stack ui] group delete ${Date.now()}`;
  const slot = quietSlot(4);
  try {
    await saveForTwo(api, slot, tag);
    const editor = await openFromCalendar(page, slot, BLUESKY.name, `${tag} bluesky`);
    await editor.getByRole('button', { name: 'Delete Post' }).click();
    await expect(page.getByText('This post was created for more than one channel', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: `Only from ${BLUESKY.name}` }).click();
    await expect(editor).toBeHidden();

    await expect
      .poll(async () => (await listPosts(api)).filter((p) => p.content.includes(tag)).map((p) => p.content))
      .toEqual([`${tag} mastodon`].map((c) => expect.stringContaining(c)));
  } finally {
    await cleanUp(api, tag);
    await api.dispose();
  }
});

test('a save that fails on a channel brings that channel into view', async ({ page }) => {
  // The editor's focus() called fix() on the channel's handle, which never had
  // it: a Discord post without its channel showed a toast and stayed on the
  // global editor, with the settings to fix hidden.
  test.setTimeout(60_000);
  const text = `[stack ui] fix focus ${Date.now()}`;
  await openComposer(page, 'bluesky', text);
  await page.getByRole('img', { name: 'discord', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add to calendar' }).click();
  await expect(page.getByText(`${USERS.a.discord.name} Settings`)).toBeVisible();
  // With the settings folded the editor is on that channel too.
  await page.getByText(`${USERS.a.discord.name} Settings`).click();
  await expect(page.getByRole('button', { name: USERS.a.discord.name, exact: true })).toHaveAttribute('aria-pressed', 'true');
});
