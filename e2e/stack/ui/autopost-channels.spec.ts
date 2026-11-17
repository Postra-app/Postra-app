import { expect, test } from '@playwright/test';

// 2026-10-10 on prod: a new Auto Post feed started on "All integrations", so
// one unguarded Save would post every new article, written by AI, to every
// channel the organisation has, a personal profile included. A new feed now
// starts on "Specific integrations" and cannot be saved without a channel.
test('a new Auto Post feed starts with no channels chosen', async ({ page }) => {
  await page.goto('/autopost');
  // The product is "Auto Post" in the menu, the plans and Help; this page
  // called it "Autopost".
  await expect(page.locator('h3', { hasText: /^Auto Post$/ })).toBeVisible();
  await expect(page.getByText('Auto Post publishes new items from your RSS feeds to your social media')).toBeVisible();
  await page.getByRole('button', { name: 'Add an Auto Post feed', exact: true }).click();
  const channels = page.locator('select').filter({ has: page.locator('option[value="specific"]') });
  await expect(channels).toHaveValue('specific');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
});

// Editing a feed saved with "sync last = Yes" sent `lastUrl: ""` and the
// server stored it: the cursor was gone, so the next run posted the newest
// article again on every channel of the feed (FG-F-1).
test('editing a feed keeps where it got to', async ({ browser }) => {
  const { database, throwawayOrg } = await import('../helpers');
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const feed = await prisma.autoPost.create({
      data: {
        organizationId: org.orgId,
        title: 'Cafe news',
        url: 'https://example.com/feed.xml',
        lastUrl: 'https://example.com/articles/newest',
        onSlot: false,
        syncLast: true,
        active: false,
        addPicture: false,
        generateContent: false,
        integrations: JSON.stringify([{ id: org.channelIds[0] }]),
      },
    });
    await context.addCookies((await org.api.storageState()).cookies);
    const page = await context.newPage();
    await page.goto('/autopost');
    await page.getByRole('button', { name: 'Edit', exact: true }).click({ timeout: 20_000 });
    const put = page.waitForRequest((r) => r.method() === 'PUT' && r.url().includes(`/autopost/${feed.id}`));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const body = (await put).postDataJSON();
    expect(body).not.toHaveProperty('lastUrl');
    await expect
      .poll(async () => (await prisma.autoPost.findUnique({ where: { id: feed.id } }))?.lastUrl)
      .toBe('https://example.com/articles/newest');
  } finally {
    await context.close();
    await org.remove();
    await prisma.$disconnect();
  }
});
