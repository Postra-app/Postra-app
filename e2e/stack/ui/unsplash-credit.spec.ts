import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Unsplash approves production use only if a post with one of its photos
// credits the photographer in the post text. A photo from Unsplash in the
// media library brings its credit line into the post it goes into.
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 900 } });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

test('a photo from Unsplash put into a post brings its credit into the text', async ({ page, context }) => {
  test.setTimeout(90_000);
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1, provider: 'bluesky' });
  try {
    const name = `unsplash-credit-${Date.now()}.png`;
    const up = await org.api.post('/media/upload-simple', {
      multipart: { file: { name, mimeType: 'image/png', buffer: PNG } },
    });
    expect(up.status(), await up.text()).toBe(201);
    const credit = 'Photo by Stack Lens (@stack.lens) on Unsplash';
    await prisma.media.update({ where: { id: (await up.json()).id }, data: { credit } });

    await context.addCookies((await org.api.storageState()).cookies);
    await page.goto('/launches');
    await page.getByRole('button', { name: 'Create Post' }).click();
    const editor = page.getByRole('dialog', { name: 'Post editor' });
    await editor.locator('[contenteditable="true"]').first().click();
    await page.keyboard.type('Fresh bread this morning');
    await editor.getByRole('button', { name: 'Insert Media' }).click();
    const library = page.getByRole('dialog').filter({ hasText: 'Media Library' });
    await library.getByRole('checkbox', { name, exact: true }).click();
    await library.getByRole('button', { name: 'Add selected media', exact: true }).click();
    await expect(library).toBeHidden();

    const text = editor.locator('[contenteditable="true"]').first();
    await expect(text).toContainText('Fresh bread this morning');
    await expect(text).toContainText(credit);
    // Once, however often the photo is added.
    expect((await text.innerText()).split(credit).length - 1).toBe(1);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

test('an Unsplash photo in a Studio design brings its credit into the post', async ({ page, context }) => {
  test.setTimeout(120_000);
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1, provider: 'bluesky' });
  try {
    await context.addCookies((await org.api.storageState()).cookies);
    await page.goto('/studio');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Blank canvas/ }).click();
    await page.getByRole('button', { name: 'Stock photos', exact: true }).click();
    await page.getByRole('button', { name: 'Unsplash', exact: true }).click();
    await page.getByPlaceholder('e.g. coffee, office, summer').fill(`rye loaf ${Date.now()}`);
    await page.keyboard.press('Enter');
    const imported = page.waitForResponse(
      (r) => r.url().endsWith('/media/unsplash-images/import') && r.request().method() === 'POST'
    );
    await page.getByTitle(/Stack Lens \(Unsplash\)/).click();
    expect((await imported).status()).toBe(201);

    // The export is a new picture: the credit travels with it.
    const exported = page.waitForResponse(
      (r) => r.url().includes('/media/upload-simple') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Use in post' }).click();
    const design = await (await exported).json();
    const credit = 'Photo by Stack Lens (@stack.lens) on Unsplash';
    expect(design.credit).toBe(credit);
    expect((await prisma.media.findUniqueOrThrow({ where: { id: design.id } })).credit).toBe(credit);

    const editor = page.getByRole('dialog', { name: 'Post editor' });
    await expect(editor.locator('[contenteditable="true"]').first()).toContainText(credit, { timeout: 30_000 });
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
