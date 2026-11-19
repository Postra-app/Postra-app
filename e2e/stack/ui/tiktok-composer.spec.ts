import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// The TikTok preview covered the photo with the caption, cropped a 4:5
// photo to the 9:16 frame and put the first comment over the post; and the
// comment's counter said 2,000 (the caption's limit) where TikTok takes
// 1,200.
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1496, height: 900 } });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

test('TikTok: the photo is shown whole, the comment sits under the post, and counts to 1,200', async ({ page, context }) => {
  test.setTimeout(120_000);
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 1, provider: 'tiktok' });
  try {
    // First comment turned on for the channel (its second authorization).
    await prisma.integration.updateMany({
      where: { organizationId: org.orgId },
      data: { grantedScopes: JSON.stringify(['comment.list.manage']) },
    });
    const name = `tiktok-preview-${Date.now()}.png`;
    const up = await org.api.post('/media/upload-simple', {
      multipart: { file: { name, mimeType: 'image/png', buffer: PNG } },
    });
    expect(up.status(), await up.text()).toBe(201);
    await page.route('**/api/integrations/function', (route) =>
      route.fulfill({ status: 201, contentType: 'application/json', body: 'false' })
    );

    await context.addCookies((await org.api.storageState()).cookies);
    await page.goto('/launches');
    await page.getByRole('button', { name: 'Create Post' }).click();
    const editor = page.getByRole('dialog', { name: 'Post editor' });
    await page.getByRole('img', { name: 'tiktok', exact: true }).first().click();

    const caption = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of a long caption.`).join(' ');
    await editor.locator('[contenteditable="true"]').first().click();
    await page.keyboard.type(caption);
    await editor.getByRole('button', { name: 'Insert Media' }).first().click();
    const library = page.getByRole('dialog').filter({ hasText: 'Media Library' });
    await library.getByRole('checkbox', { name, exact: true }).click();
    await library.getByRole('button', { name: 'Add selected media', exact: true }).click();
    await expect(library).toBeHidden();

    await editor.getByRole('button', { name: /^Add comment/ }).click();
    await editor.locator('[contenteditable="true"]').nth(1).click();
    await page.keyboard.type('Get early access');
    await expect(editor.getByText('16/1200', { exact: true }).first()).toBeVisible();

    // The channel's own tab shows its preview.
    await page.getByRole('button', { name: 'Throwaway tiktok 0', exact: true }).click();

    const frame = page.getByTestId('tiktok-preview-frame');
    await expect(frame).toBeVisible();
    await expect(frame.locator('img').first()).toHaveCSS('object-fit', 'contain');
    await expect(frame.getByText('more', { exact: true })).toBeVisible();
    const comments = page.getByTestId('tiktok-preview-comments');
    await expect(comments).toContainText('Get early access');
    const f = (await frame.boundingBox())!;
    const c = (await comments.boundingBox())!;
    expect(c.y).toBeGreaterThanOrEqual(f.y + f.height);
    await page.screenshot({ path: 'e2e/stack/.results/tiktok-preview.png' });

    // On the channel's own text: the caption counts to 2,000, the comment
    // to 1,200.
    await editor.getByRole('button', { name: 'Edit content' }).click();
    await expect(editor.getByText(`${caption.length}/2000`, { exact: true })).toBeVisible();
    await expect(editor.getByText('16/1200', { exact: true })).toBeVisible();
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
