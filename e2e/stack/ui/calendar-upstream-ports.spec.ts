import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { channelOf, database, signedIn, stateFile } from '../helpers';

// UI of the upstream ports from the 2026-10-06 review: channel rename
// (5a1e92b4), channel filter above the calendar (9bf96ebc), open-the-published
// -post link and green frame (e70110fe, b08bad84). Organisation B with one
// extra channel of its own, so A's UI tests are not disturbed.
test.use({ storageState: stateFile('b') });
test.describe.configure({ mode: 'serial' });

const EXTRA = { id: `stack-extra-b-${process.pid}`, name: 'Stack Extra B' };
let prisma: PrismaClient;
test.beforeAll(async () => {
  prisma = database();
  const org = await prisma.integration.findUniqueOrThrow({ where: { id: channelOf('b') }, select: { organizationId: true } });
  await prisma.integration.create({
    data: { id: EXTRA.id, internalId: `${EXTRA.id}-internal`, organizationId: org.organizationId, name: EXTRA.name, providerIdentifier: 'bluesky', type: 'social', token: 'fake-token', profile: EXTRA.id },
  });
});
test.afterAll(async () => {
  await prisma.post.deleteMany({ where: { integrationId: EXTRA.id } });
  await prisma.integration.delete({ where: { id: EXTRA.id } });
  await prisma.$disconnect();
});

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const weekUrl = (at: Date) => {
  const monday = new Date(at);
  monday.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return `/launches?display=week&startDate=${isoDay(monday)}&endDate=${isoDay(sunday)}`;
};
const draft = async (channel: string, content: string, at: Date) => {
  const api = await signedIn('b');
  const res = await api.post('/posts', {
    data: { type: 'draft', shortLink: false, date: at.toISOString(), tags: [], posts: [{ type: 'draft', integration: { id: channel }, value: [{ content, image: [] }], settings: { __type: 'bluesky' } }] },
  });
  expect(res.status(), await res.text()).toBe(201);
  await api.dispose();
  return (await prisma.post.findFirstOrThrow({ where: { content: { contains: content }, deletedAt: null } })).id;
};

test('a channel renamed from its menu shows the new name, and resets', async ({ page }) => {
  await page.goto('/launches');
  const menuOf = (name: string) =>
    page.getByText(name, { exact: true }).locator('xpath=ancestor::*[.//*[@aria-label="Channel options"]][1]').getByRole('button', { name: 'Channel options' });
  await menuOf(EXTRA.name).click();
  await page.getByText('Rename channel', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Client X — Bluesky');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Client X — Bluesky', { exact: true }).first()).toBeVisible();
  expect((await prisma.integration.findUnique({ where: { id: EXTRA.id } }))?.name).toBe(EXTRA.name);

  await menuOf('Client X — Bluesky').click();
  await page.getByText('Reset to original name', { exact: true }).click();
  await expect(page.getByText(EXTRA.name, { exact: true }).first()).toBeVisible();
  expect((await prisma.integration.findUnique({ where: { id: EXTRA.id } }))?.customName ?? null).toBeNull();
});

test('the channel filter hides the posts of unticked channels', async ({ page }) => {
  const at = new Date(Date.now() + 3 * 86_400_000);
  at.setUTCHours(4, 15, 0, 0);
  const tag = Date.now();
  await draft(channelOf('b'), `Filter main ${tag}`, at);
  await draft(EXTRA.id, `Filter extra ${tag}`, at);
  await page.goto(weekUrl(at));
  await expect(page.locator('[role=button]', { hasText: `Filter extra ${tag}` })).toBeVisible();

  await page.getByRole('button', { name: 'Show channels' }).click();
  await page.getByRole('checkbox', { name: EXTRA.name }).click();
  await expect(page.locator('[role=button]', { hasText: `Filter extra ${tag}` })).toHaveCount(0);
  await expect(page.locator('[role=button]', { hasText: `Filter main ${tag}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show channels' })).toContainText('1/2');
});

test('a published post is framed green and links to the platform', async ({ page, context }) => {
  const at = new Date(Date.now() + 4 * 86_400_000);
  at.setUTCHours(4, 20, 0, 0);
  const text = `Published link ${Date.now()}`;
  const id = await draft(EXTRA.id, text, at);
  await prisma.post.update({ where: { id }, data: { state: 'PUBLISHED', releaseURL: 'https://bsky.app/profile/x/post/1,https://bsky.app/profile/x/post/2', releaseId: 'r1' } });
  let opened = '';
  await context.route(/bsky\.app/, (route) => {
    opened = route.request().url();
    return route.abort();
  });
  await page.goto(weekUrl(at));
  const tile = page.locator('[role=button]', { hasText: text });
  await tile.focus();
  await page.getByRole('button', { name: 'Open the published post' }).first().click();
  await expect.poll(() => opened).toBe('https://bsky.app/profile/x/post/1');
  await expect(page.locator('.ring-green-500', { hasText: text })).toHaveCount(1);
});
