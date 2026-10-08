import { expect, test } from '@playwright/test';
import { listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';
import { quietSlot } from './ui-helpers';

// The page a client opens from "Share with a client" (docs P3 check,
// 2026-10-09): it showed the client how the post was made (a WEB / API / MCP
// badge meant for staff), and its Close button read "Zamknij" in the UK app.
test('the client preview shows no creation badge, and Close is in English', async ({ page, browser }) => {
  const api = await signedIn('a');
  const content = `[stack ui] client preview ${Date.now()}`;
  const created = await api.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: quietSlot(5).toISOString(),
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
  const { id, group } = (await listPosts(api)).find((p) => p.content.includes(content))!;

  const client = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const clientPage = await client.newPage();
    await clientPage.goto(`/p/${id}`);
    await expect(clientPage.getByText(content)).toBeVisible();
    await expect(clientPage.getByText('WEB', { exact: true })).toHaveCount(0);

    await page.goto(`/p/${id}?share=true`);
    await expect(page.getByText(content)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await expect(page.getByText('Zamknij')).toHaveCount(0);
  } finally {
    await client.close();
    await api.delete(`/posts/${group}`);
    await api.dispose();
  }
});
