import { expect, test } from '@playwright/test';
import { database, signedIn } from '../helpers';
import { USERS } from '../seed';
import { quietSlot, weekOf } from './ui-helpers';

// K. 2026-10-07 (🆕 pkt 2b): Post Statistics on a platform that gives apps no
// post statistics said "No statistics available for this post", as if they
// were still to come.
const prisma = database();
test.afterAll(async () => {
  await prisma.$disconnect();
});

test('Post Statistics says when the platform shares none', async ({ page }) => {
  const api = await signedIn('a');
  const text = `[stack ui] no stats ${Date.now()}`;
  const slot = quietSlot(-1);
  const res = await api.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: slot.toISOString(),
      tags: [],
      posts: [{ integration: { id: USERS.a.discord.id }, value: [{ content: text, image: [] }], settings: { __type: 'discord' } }],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const [{ postId }] = (await res.json()) as { postId: string }[];
  const { group } = await prisma.post.update({
    where: { id: postId },
    data: { state: 'PUBLISHED', releaseId: '987654321' },
  });
  try {
    await page.goto(weekOf(slot));
    await page.locator('[role=button]', { hasText: text }).focus();
    await page.getByRole('button', { name: 'Post Statistics' }).first().click();
    await expect(page.getByText("This platform doesn't share post statistics with apps", { exact: false })).toBeVisible();
    await expect(page.getByText('No statistics available for this post')).toHaveCount(0);
  } finally {
    await api.delete(`/posts/${group}`);
    await api.dispose();
  }
});
