import { expect, test } from '@playwright/test';
import { listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';
import { quietSlot, weekOf } from './ui-helpers';

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

    await tile.dragTo(to);
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
