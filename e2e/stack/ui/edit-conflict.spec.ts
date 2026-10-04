import { expect, Page, test } from '@playwright/test';
import { signedIn } from '../helpers';
import { USERS } from '../seed';
import { quietSlot, weekOf } from './ui-helpers';

// Someone saves the post while it is open in my editor: saving mine asks
// whether to replace their version or keep it (api/edit-conflict.spec.ts).

// A draft in a slot of its own: drafts other tests make two days ahead fold
// into "show more" in a busy cell.
const SLOT = quietSlot(3);

const openEditor = async (page: Page, content: string) => {
  await page.goto(weekOf(SLOT));
  await page
    .getByRole('button', { name: `Open post: ${USERS.a.channel.name}` })
    .filter({ hasText: content })
    .click();
  return page.getByRole('dialog', { name: 'Post editor' });
};

const theyEdit = async (id: string, group: string, content: string) => {
  const api = await signedIn('a');
  const res = await api.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: SLOT.toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: USERS.a.channel.id },
          group,
          value: [{ id, content, image: [] }],
          settings: { __type: 'bluesky' },
        },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  await api.dispose();
};

const contentOf = async (id: string) => {
  const api = await signedIn('a');
  const post = (await (await api.get(`/posts/${id}`)).json()).posts[0];
  await api.dispose();
  return post.content as string;
};

for (const choice of ['Replace with mine', 'Keep theirs'] as const) {
  test(`a post changed while open: "${choice}"`, async ({ page }) => {
    test.setTimeout(60_000);
    const api = await signedIn('a');
    const content = `[stack ui] edit conflict ${choice} ${Date.now()}`;
    const created = await api.post('/posts', {
      data: {
        type: 'draft',
        shortLink: false,
        date: SLOT.toISOString(),
        tags: [],
        posts: [
          {
            integration: { id: USERS.a.channel.id },
            value: [{ content, image: [] }],
            settings: { __type: 'bluesky' },
          },
        ],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { postId } = (await created.json())[0];
    const draft = { id: postId as string, group: (await (await api.get(`/posts/${postId}`)).json()).group as string };
    await api.dispose();

    const editor = await openEditor(page, content);
    await editor.locator('.ProseMirror').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' mine');

    await theyEdit(draft.id, draft.group, `${content} theirs`);

    await editor.getByRole('button', { name: 'Save as draft' }).click();
    await expect(page.getByText('This post was changed')).toBeVisible();
    await page.getByRole('button', { name: choice, exact: true }).click();
    await expect(editor).toBeHidden();

    await expect
      .poll(() => contentOf(draft.id))
      .toContain(choice === 'Replace with mine' ? ' mine' : ' theirs');
  });
}
