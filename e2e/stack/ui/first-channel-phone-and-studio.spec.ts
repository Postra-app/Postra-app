import { expect, Page, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Two dead ends of an account with no channel yet, reported by a reviewer
// the day before launch.
test.use({ storageState: { cookies: [], origins: [] } });

const phone = { width: 390, height: 844 };

const onScreen = async (page: Page, name: string) => {
  const button = page.getByRole('button', { name, exact: true }).filter({ visible: true });
  await expect(button).toHaveCount(1);
  const box = await button.boundingBox();
  const width = await page.evaluate(() => window.innerWidth);
  expect(width).toBe(phone.width);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(box!.width).toBeGreaterThan(40);
  return button;
};

// The channel column is hidden on a phone and Add Channel lived only there:
// the calendar was a list with "No posts" and nothing to press.
test('on a phone a new account can add its first channel from the calendar', async ({ page, context }) => {
  await page.setViewportSize(phone);
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    await context.addCookies((await org.api.storageState()).cookies);
    await page.goto('/launches');
    await expect(page.getByText('No channels yet').filter({ visible: true })).toHaveCount(1);
    await (await onScreen(page, 'Add Channel')).click();
    await expect(page.locator('.launches-provider-card', { hasText: 'Bluesky' })).toBeVisible();
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

test('on a phone an account with a channel has both Create Post and Add Channel', async ({ page, context }) => {
  await page.setViewportSize(phone);
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 1 });
  try {
    await context.addCookies((await org.api.storageState()).cookies);
    await page.goto('/launches');
    await onScreen(page, 'Add Channel');
    await (await onScreen(page, 'Create Post')).click();
    await expect(page.getByRole('dialog', { name: 'Post editor' })).toBeVisible();
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

// Studio's "Use in Post" opens the calendar with the design in the address.
// With no channel there is no post editor, and the answer was an empty
// calendar: nothing said the design was not used.
test('Use in Post without a channel says the design waits, and the post opens with it once a channel exists', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    await context.addCookies((await org.api.storageState()).cookies);
    const design = [{ id: 'stack-design-1', path: '/postra-icon.webp' }];
    await page.goto(`/launches?newPostMedia=${encodeURIComponent(JSON.stringify(design))}`);
    const notice = page.getByTestId('design-waiting');
    await expect(notice).toContainText('Your design is saved in Media.');
    await expect(notice).toContainText('Add a channel and a new post opens with it.');
    await expect(page.getByRole('dialog', { name: 'Post editor' })).toHaveCount(0);

    // The first channel arrives (connecting one reloads the calendar, and
    // the address no longer carries the design).
    await prisma.integration.create({
      data: {
        id: `first-${org.orgId}`,
        internalId: `first-${org.orgId}-internal`,
        organizationId: org.orgId,
        name: 'First channel',
        providerIdentifier: 'bluesky',
        type: 'social',
        token: 'fake-token',
        profile: 'first',
      },
    });
    await page.goto('/launches');
    const editor = page.getByRole('dialog', { name: 'Post editor' });
    await expect(editor).toBeVisible();
    await expect(editor.locator('img[src*="postra-icon.webp"]').first()).toBeVisible();
    await expect(page.getByTestId('design-waiting')).toHaveCount(0);

    // Used once: the next visit does not open it again.
    await page.goto('/launches');
    await expect(page.getByRole('button', { name: 'Create Post' }).first()).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Post editor' })).toHaveCount(0);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

test('"Not now" drops the waiting design', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    await context.addCookies((await org.api.storageState()).cookies);
    const design = [{ id: 'stack-design-2', path: '/postra-icon.webp' }];
    await page.goto(`/launches?newPostMedia=${encodeURIComponent(JSON.stringify(design))}`);
    await page.getByTestId('design-waiting').getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByTestId('design-waiting')).toHaveCount(0);
    await page.goto('/launches');
    await expect(page.getByText('No channels yet').first()).toBeVisible();
    await expect(page.getByTestId('design-waiting')).toHaveCount(0);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

// The design waits in the browser tab. Signing out and into another account
// in that tab must not hand it over.
test('a waiting design is not offered to another account in the same tab', async ({ page, context }) => {
  const prisma = database();
  const first = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  const other = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 1 });
  try {
    await context.addCookies((await first.api.storageState()).cookies);
    const design = [{ id: 'stack-design-3', path: '/postra-icon.webp' }];
    await page.goto(`/launches?newPostMedia=${encodeURIComponent(JSON.stringify(design))}`);
    await expect(page.getByTestId('design-waiting')).toBeVisible();

    await context.clearCookies();
    await context.addCookies((await other.api.storageState()).cookies);
    await page.goto('/launches');
    await expect(page.getByRole('button', { name: 'Create Post' }).first()).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByRole('dialog', { name: 'Post editor' })).toHaveCount(0);
    await expect(page.getByTestId('design-waiting')).toHaveCount(0);
  } finally {
    await first.remove();
    await other.remove();
    await prisma.$disconnect();
  }
});
