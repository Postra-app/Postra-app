import { expect, test } from '@playwright/test';
import { listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';
import { quietSlot } from './ui-helpers';

// Post content is HTML from the editor, and the public preview /p/<id> shows
// it to anyone with the link, signed out. Script, event handlers and
// javascript: links in it must render as inert text. Production's WAF blocks
// such a body before it reaches the app, so this is where the app's own
// sanitising is checked.
const marker = `[stack ui] xss probe ${Date.now()}`;
const payload =
  `<p>${marker}</p><img src=x onerror="alert('img')"><script>alert('script')</script>` +
  `<a href="javascript:alert('link')">click</a><svg onload="alert('svg')"></svg>`;

test('a post with HTML and script in it renders inert in the public preview', async ({ browser }) => {
  const api = await signedIn('a');
  const created = await api.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: quietSlot(6).toISOString(),
      tags: [],
      posts: [
        {
          type: 'draft',
          integration: { id: USERS.a.channel.id },
          value: [{ content: payload, image: [] }],
          settings: { __type: 'bluesky' },
        },
      ],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id, group } = (await listPosts(api)).find((p) => p.content.includes(marker))!;

  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const preview = await anon.newPage();
    const dialogs: string[] = [];
    preview.on('dialog', (d) => {
      dialogs.push(d.message());
      d.dismiss();
    });
    await preview.goto(`/p/${id}?share=true`);
    await expect(preview.getByText(marker)).toBeVisible();
    await preview.waitForTimeout(1500);
    expect(dialogs).toEqual([]);
    expect(
      await preview.evaluate(() => ({
        handlers: [...document.querySelectorAll('*')].filter((el) =>
          [...el.attributes].some((a) => /^on/i.test(a.name))
        ).length,
        scripts: [...document.querySelectorAll('script')].filter((s) =>
          s.textContent?.includes('alert(')
        ).length,
        jsLinks: document.querySelectorAll('a[href^="javascript:" i]').length,
      }))
    ).toEqual({ handlers: 0, scripts: 0, jsLinks: 0 });
  } finally {
    await anon.close();
    await api.delete(`/posts/${group}`);
    await api.dispose();
  }
});
