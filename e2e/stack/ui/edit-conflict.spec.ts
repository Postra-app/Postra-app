import { expect, Page, test } from '@playwright/test';
import { createDraft, signedIn } from '../helpers';
import { USERS } from '../seed';

// Someone saves the post while it is open in my editor: saving mine asks
// whether to replace their version or keep it (api/edit-conflict.spec.ts).

// The draft is two days ahead, often in next week: open the week it is in.
const weekOf = (date: Date) => {
  const day = (n: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return `display=week&startDate=${day(0)}&endDate=${day(6)}`;
};

const openEditor = async (page: Page, content: string) => {
  await page.goto(`/launches?${weekOf(new Date(Date.now() + 2 * 86_400_000))}`);
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
      date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
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
    const draft = await createDraft(api, 'a', content);
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
