import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Auto Post on a phone: a feed's Edit, Delete and switch sat past the right
// edge and could not be scrolled to. The page itself did not scroll sideways,
// so the shared phone-width check could not see it.
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test('a feed with a long address keeps Edit, Delete and the switch on screen', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    await prisma.autoPost.create({
      data: {
        organizationId: org.orgId,
        title: 'A weekly roundup of everything we published on the company blog',
        onSlot: true,
        syncLast: false,
        url: 'https://www.example.com/blog/category/announcements/and/news/feed/rss2-full-content.xml',
        lastUrl: '',
        active: false,
        addPicture: false,
        generateContent: true,
        integrations: '[]',
      },
    });
    await context.addCookies((await org.api.storageState()).cookies);
    await page.goto('/autopost');
    const width = await page.evaluate(() => window.innerWidth);
    expect(width).toBe(390);
    for (const control of [
      page.getByRole('button', { name: 'Edit', exact: true }),
      page.getByRole('button', { name: 'Delete', exact: true }),
    ]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box, 'control has a box').toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    const toggle = page.getByLabel('A weekly roundup', { exact: false }).last();
    const box = await toggle.boundingBox();
    expect(box, 'switch has a box').toBeTruthy();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
