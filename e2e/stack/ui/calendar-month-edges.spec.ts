import { expect, test } from '@playwright/test';
import { signedIn } from '../helpers';
import { USERS } from '../seed';

// The month view draws six weeks, so the first days of the next month are on
// screen, but only the month itself was loaded: a post added in one of those
// cells seemed not to save, and customers added it a second time.
test('the month view shows posts on the days of the next month it draws', async ({ page }) => {
  const api = await signedIn('a');
  const content = `[stack ui] month edge ${Date.now()}`;
  const now = new Date();
  // Next month's grid, and the 2nd of the month after it: always in that grid
  // (six weeks from the Monday before the 1st reach at least five days on).
  const month = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const edge = new Date(now.getFullYear(), now.getMonth() + 2, 2, 4, 20, 0, 0);
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const created = await api.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: edge.toISOString(),
      tags: [],
      posts: [
        {
          type: 'draft',
          integration: { id: USERS.a.channel.id },
          value: [{ content, image: [] }],
          settings: { __type: 'bluesky' },
        },
      ],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  // listPosts looks 30 days ahead; this post is further out.
  const window = await api.get(
    `/posts?startDate=${new Date(edge.getTime() - 86400000).toISOString()}&endDate=${new Date(edge.getTime() + 86400000).toISOString()}`
  );
  const group = ((await window.json()).p as { g: string; c: string }[]).find((p) =>
    p.c.includes(content)
  )!.g;

  try {
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    await page.goto(`/launches?display=month&startDate=${ymd(month)}&endDate=${ymd(last)}`);
    await expect(
      page
        .getByRole('button', { name: `Open post: ${USERS.a.channel.name}` })
        .filter({ hasText: content })
    ).toBeVisible();
  } finally {
    await api.delete(`/posts/${group}`);
    await api.dispose();
  }
});
