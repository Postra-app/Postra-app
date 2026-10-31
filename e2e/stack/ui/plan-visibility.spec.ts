import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// What a plan includes was learnt from a 402: the paywall did not say which
// platforms Starter covers (YouTube turned out not to be one), and Auto Post on
// Starter showed the whole form before refusing the save.
test.use({ storageState: { cookies: [], origins: [] } });

test('the paywall names the platforms Starter covers', async ({ page, context }) => {
  const prisma = database();
  const free = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  await prisma.subscription.deleteMany({ where: { organizationId: free.orgId } });
  try {
    await context.addCookies((await free.api.storageState()).cookies);
    await context.route(/js\.stripe\.com/, (route) => route.abort());
    await page.goto('/billing');
    await expect(page.getByText('On Facebook, Instagram, TikTok, LinkedIn, Pinterest', { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await free.remove();
    await prisma.$disconnect();
  }
});

test('Auto Post on Starter shows how many feeds are left, and no form past the limit', async ({ page, context }) => {
  const prisma = database();
  const starter = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    for (const n of [1, 2]) {
      await prisma.autoPost.create({
        data: {
          organizationId: starter.orgId,
          title: `feed ${n}`,
          url: `https://example.com/feed-${n}.xml`,
          lastUrl: '',
          onSlot: false,
          syncLast: false,
          active: true,
          addPicture: false,
          generateContent: false,
          integrations: '[]',
        },
      });
    }
    await context.addCookies((await starter.api.storageState()).cookies);
    await page.goto('/autopost');
    await expect(page.getByText('2 of 2 RSS feeds used')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Add an autopost' })).toBeDisabled();
  } finally {
    await starter.remove();
    await prisma.$disconnect();
  }
});
