import { expect, test } from '@playwright/test';
import { channels, settingsFor } from './publish.helpers';

// XSS in post content, run against production with a DRAFT only (nothing is
// published) in the canary organisation: the public preview /p/<id> (no
// sign-in) and the calendar must render the payload as inert text — no dialog,
// no event-handler attributes, no javascript: links. Manual:
//   pnpm exec playwright test -c e2e/playwright --project setup --project xss

const marker = `xss-probe-${Date.now()}`;
const payload =
  `<p>${marker}</p><img src=x onerror="alert('img')"><script>alert('script')</script>` +
  `<a href="javascript:alert('link')">click</a><svg onload="alert('svg')"></svg>`;

const inert = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({
    handlers: [...document.querySelectorAll('*')].filter((el) =>
      [...el.attributes].some((a) => /^on/i.test(a.name))
    ).length,
    scripts: [...document.querySelectorAll('script')].filter((s) => s.textContent?.includes('alert(')).length,
    jsLinks: document.querySelectorAll('a[href^="javascript:" i]').length,
  }));

test('a post with HTML and script in it renders as inert text', async ({ request, browser }) => {
  const [channel] = await channels(request);
  expect(channel, 'a technical channel in the canary org').toBeTruthy();
  const created = await request.post('/api/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      tags: [],
      posts: [{ integration: { id: channel.id }, value: [{ content: payload, image: [] }], settings: await settingsFor(request, channel) }],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const list = await (await request.get(
    `/api/posts?startDate=${new Date().toISOString()}&endDate=${new Date(Date.now() + 8 * 86_400_000).toISOString()}`
  )).json();
  const post = (list.p as { i: string; g: string; c: string }[]).find((p) => p.c?.includes(marker));
  expect(post, 'the draft is listed').toBeTruthy();

  try {
    // Public preview, signed out.
    const anon = await browser.newContext();
    const preview = await anon.newPage();
    const dialogs: string[] = [];
    preview.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    await preview.goto(`/p/${post!.i}?share=true`);
    await expect(preview.getByText(marker)).toBeVisible();
    await preview.waitForTimeout(1500);
    expect(dialogs).toEqual([]);
    expect(await inert(preview)).toEqual({ handlers: 0, scripts: 0, jsLinks: 0 });
    await anon.close();
  } finally {
    await request.delete(`/api/posts/${post!.g}`);
  }
});
