import { expect, test } from '@playwright/test';
import { listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';
import { watchForErrors } from './ui-helpers';

// Editing a published post: "Republish the post" in the editor publishes it
// again, and only that answer does. The server refuses to requeue a published
// post without `republish: true` (api/republish.spec.ts), so the editor has to
// send it once the customer has chosen.

const FAKE = 'http://localhost:58080';

test('"Republish the post" in the editor publishes the post again', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watchForErrors(page);
  const api = await signedIn('a');
  const content = `[stack ui] republish ${Date.now()}`;
  const timesSent = async () =>
    ((await (await api.get(`${FAKE}/__received`)).json()) as { status: string }[]).filter(
      (r) => r.status === content
    ).length;

  try {
    const res = await api.post('/posts', {
      data: {
        type: 'now',
        shortLink: false,
        date: new Date().toISOString(),
        tags: [],
        posts: [
          {
            integration: { id: USERS.a.mastodon.id },
            value: [{ content, image: [] }],
            settings: { __type: 'mastodon' },
          },
        ],
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    await expect.poll(timesSent, { timeout: 90_000, intervals: [500, 1_000, 2_000] }).toBe(1);

    await page.goto('/launches');
    await page
      .getByRole('button', { name: `Open post: ${USERS.a.mastodon.name}` })
      .filter({ hasText: content })
      .click();
    const editor = page.getByRole('dialog', { name: 'Post editor' });
    await editor.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(page.getByText('This post was already published', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Republish the post', exact: true }).click();

    await expect.poll(timesSent, { timeout: 90_000, intervals: [500, 1_000, 2_000] }).toBe(2);
    const post = (await listPosts(api)).find((p) => p.content.includes(content));
    expect(post).toBeTruthy();
    expect(problems).toEqual([]);
  } finally {
    await api.dispose();
  }
});
