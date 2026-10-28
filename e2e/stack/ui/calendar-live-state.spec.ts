import { expect, test } from '@playwright/test';
import { listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';
import { expandShowMore, watchForErrors, weekOf } from './ui-helpers';

// A post that goes out while the calendar is open used to keep
// its "scheduled" tile for up to an hour (SWR refreshed hourly, never on
// focus). While a queued post is due the calendar now asks again every 15 s,
// so the tile turns green on its own.
const FAKE = 'http://localhost:58080';

test('a post published in the background turns green without a reload', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems = watchForErrors(page);
  const api = await signedIn('a');
  const content = `[stack ui] live state ${Date.now()}`;
  const timesSent = async () =>
    ((await (await api.get(`${FAKE}/__received`)).json()) as { status: string }[]).filter(
      (r) => r.status === content
    ).length;
  const at = new Date(Date.now() + 75_000);
  const res = await api.post('/posts', {
    data: {
      type: 'schedule',
      shortLink: false,
      date: at.toISOString(),
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
  const post = (await listPosts(api)).find((p) => p.content.includes(content))!;
  try {
    await page.goto(weekOf(at));
    await expandShowMore(page);
    const tile = page
      .getByRole('button', { name: `Open post: ${USERS.a.mastodon.name}` })
      .filter({ hasText: content });
    await expect(tile).toBeVisible();
    await expect(tile).not.toHaveText(/Published:/);
    // The scheduler sends it...
    await expect.poll(timesSent, { timeout: 120_000, intervals: [1_000, 2_000] }).toBe(1);
    // ...and the open calendar shows it, no reload.
    await expect(tile).toHaveText(/Published:/, { timeout: 60_000 });
    expect(problems).toEqual([]);
  } finally {
    await api.delete(`/posts/${post.group}`);
    await api.dispose();
  }
});
