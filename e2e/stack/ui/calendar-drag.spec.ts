import { expect, test } from '@playwright/test';
import { listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';
import { dragWithMouse, quietSlot, weekOf } from './ui-helpers';

// E2E-05-49: a post dragged to another slot moves on screen before the
// server answers. When the server refused (the post deleted in another tab,
// a 404), the tile stayed in the new slot as if it had been saved.

const SLOT = quietSlot(4);

test('E2E-05-49: a move the server refuses puts the post back', async ({
  page,
}) => {
  const api = await signedIn('a');
  const content = `[stack ui] refused drag ${Date.now()}`;
  const created = await api.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: SLOT.toISOString(),
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
  const { id, group } = (await listPosts(api)).find((p) =>
    p.content.includes(content)
  )!;

  try {
    let refused = 0;
    await page.route(`**/posts/${id}/date`, (route) => {
      refused++;
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: '{"message":"Post not found"}',
      });
    });
    await page.goto(weekOf(SLOT));
    const tile = page
      .getByRole('button', { name: `Open post: ${USERS.a.channel.name}` })
      .filter({ hasText: content });
    // The calendar shows the user's time zone: read the slot the tile sits
    // in, then aim an hour earlier the same day (in view, still in the future).
    await expect(tile).toBeVisible();
    const fromSlot = (await page
      .locator('[data-slot]')
      .filter({ has: tile })
      .last()
      .getAttribute('data-slot'))!;
    const hour = Number(fromSlot.slice(11, 13));
    const toSlot = `${fromSlot.slice(0, 11)}${String(hour - 1).padStart(
      2,
      '0'
    )}:00`;
    const from = page.locator(`[data-slot="${fromSlot}"]`);
    const to = page.locator(`[data-slot="${toSlot}"]`);

    await dragWithMouse(page, tile, to);
    await expect.poll(() => refused).toBe(1);

    // Back where the server has it, not where it was dropped.
    await expect(to.getByText(content)).toHaveCount(0);
    await expect(from.getByText(content)).toBeVisible();
    expect(
      (await (await api.get(`/posts/${id}`)).json()).posts[0].publishDate
    ).toBe(SLOT.toISOString());
  } finally {
    await api.delete(`/posts/${group}`);
    await api.dispose();
  }
});

test('E2E-05-49: the old week answering late does not replace the new week', async ({
  page,
}) => {
  // After a refused move the calendar reloads the week it was on. If the
  // customer moves to the next week before that answer arrives, the late
  // answer must not replace what the next week shows (Codex, 2026-10-07).
  const api = await signedIn('a');
  const stamp = Date.now();
  const make = async (when: Date, content: string) => {
    const res = await api.post('/posts', {
      data: {
        type: 'draft',
        shortLink: false,
        date: when.toISOString(),
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
    expect(res.status(), await res.text()).toBe(201);
    return (await listPosts(api)).find((p) => p.content.includes(content))!;
  };
  const here = await make(SLOT, `[stack ui] this week ${stamp}`);
  const later = new Date(SLOT.getTime() + 7 * 86_400_000);
  const there = await make(later, `[stack ui] next week ${stamp}`);

  try {
    await page.route(`**/posts/${here.id}/date`, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: '{}',
      })
    );
    // The startDate this week's posts are asked with, as the page sends it.
    const weekLoad = page.waitForRequest((r) =>
      /\/posts\?.*startDate=/.test(r.url())
    );
    await page.goto(weekOf(SLOT));
    const thisWeek = new URL((await weekLoad).url()).searchParams.get(
      'startDate'
    );
    const tile = page
      .getByRole('button', { name: `Open post: ${USERS.a.channel.name}` })
      .filter({ hasText: here.content });
    await expect(tile).toBeVisible();
    const fromSlot = (await page
      .locator('[data-slot]')
      .filter({ has: tile })
      .last()
      .getAttribute('data-slot'))!;
    const hour = Number(fromSlot.slice(11, 13));
    const to = page.locator(
      `[data-slot="${fromSlot.slice(0, 11)}${String(hour - 1).padStart(
        2,
        '0'
      )}:00"]`
    );

    // From the drop on, this week's posts answer 3 s late.
    await page.route(/\/posts\?/, async (route) => {
      const start = new URL(route.request().url()).searchParams.get(
        'startDate'
      );
      if (start === thisWeek) {
        await new Promise((r) => setTimeout(r, 3_000));
      }
      await route.continue();
    });
    await dragWithMouse(page, tile, to);
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.getByText(there.content)).toBeVisible();
    // The late answer for the previous week has arrived by now.
    await page.waitForTimeout(4_000);
    await expect(page.getByText(there.content)).toBeVisible();
    await expect(page.getByText(here.content)).toHaveCount(0);
  } finally {
    await api.delete(`/posts/${here.group}`);
    await api.delete(`/posts/${there.group}`);
    await api.dispose();
  }
});

// A post dropped on another day in Month view kept no time of its own: the
// cell stands for the whole day and the drop sent its end, 23:59 (found while
// writing the calendar docs, 2026-10-09). It keeps its time of day.
test('a post moved in Month view keeps its time of day', async ({ page }) => {
  const api = await signedIn('a');
  const content = `[stack ui] month drag ${Date.now()}`;
  const slot = quietSlot(4);
  const target = new Date(slot);
  // Another day of the same month, still in the future.
  target.setDate(slot.getDate() === 1 ? slot.getDate() + 1 : slot.getDate() - 1);
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const created = await api.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: slot.toISOString(),
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

  try {
    const first = new Date(slot.getFullYear(), slot.getMonth(), 1);
    const last = new Date(slot.getFullYear(), slot.getMonth() + 1, 0);
    await page.goto(`/launches?display=month&startDate=${ymd(first)}&endDate=${ymd(last)}`);
    const tile = page
      .getByRole('button', { name: `Open post: ${USERS.a.channel.name}` })
      .filter({ hasText: content });
    await expect(tile).toBeVisible();
    const saved = page.waitForResponse((r) => r.url().includes(`/posts/${id}/date`) && r.request().method() === 'PUT');
    await dragWithMouse(page, tile, page.locator(`[data-slot="${ymd(target)}T23:59"]`));
    expect((await saved).status()).toBeLessThan(300);

    const expected = new Date(target);
    expected.setHours(slot.getHours(), slot.getMinutes(), 0, 0);
    expect((await (await api.get(`/posts/${id}`)).json()).posts[0].publishDate).toBe(expected.toISOString());
  } finally {
    await api.delete(`/posts/${group}`);
    await api.dispose();
  }
});
