import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// The web app had no way to change your name, bio or picture — the settings
// form loaded and saved them but showed no fields.
test('Global Settings change your name and bio, and they stay', async ({ page }) => {
  await page.goto('/settings');
  const card = page.getByText('Profile', { exact: true }).locator('xpath=ancestor::*[contains(@class,"p-[24px]")][1]');
  // Editable once the saved profile has arrived.
  await expect(page.getByLabel('Full Name')).toBeEnabled();
  const original = await page.getByLabel('Full Name').inputValue();
  const name = `Stack Profile ${Date.now()}`;
  try {
    await page.getByLabel('Full Name').fill(name);
    await page.getByLabel('Bio').fill('Plans the posts.');
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Profile updated')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Full Name')).toHaveValue(name);
    await expect(page.getByLabel('Bio')).toHaveValue('Plans the posts.');
  } finally {
    await page.request.post('/api/user/personal', { data: { fullname: original || 'Stack User', bio: '' } });
  }
});

// The media library hands back a list of chosen files, and the card read an id
// and path from the list itself, so a chosen picture never showed and saving
// sent an empty one.
//
// Its own organisation and user: the library shows 18 files a page, and in a
// full run other specs upload to the shared organisation in parallel, so the
// test's file could be pushed onto page 2 between the upload and opening the
// library, and the test waited out its 60 s (twice in full runs). A later
// upload of its own still makes the test pick its file, not the newest.
test.describe('a picture from the library', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a picture chosen from the library shows and is saved', async ({ page, context }) => {
    test.setTimeout(60_000);
    const prisma = database();
    const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
    try {
      const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      const original = `profile-${Date.now()}.png`;
      const res = await owner.api.post('/media/upload-simple', {
        multipart: { file: { name: original, mimeType: 'image/png', buffer: PNG } },
      });
      expect(res.status(), await res.text()).toBe(201);
      const media: { id: string; path: string } = await res.json();
      const later = await owner.api.post('/media/upload-simple', {
        multipart: { file: { name: `profile-later-${Date.now()}.png`, mimeType: 'image/png', buffer: PNG } },
      });
      expect(later.status(), await later.text()).toBe(201);

      await context.addCookies((await owner.api.storageState()).cookies);
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Choose picture', exact: true }).click();
      const file = media.path.split('/').pop()!;
      // A tile is a checkbox named like its caption, the file's original name.
      // The library opened outside any window, its grid had no height and
      // the button row covered every tile: only a synthetic click got through.
      // A real click inside the window now picks the file.
      const library = page.getByRole('dialog').filter({ hasText: 'Media Library' });
      await expect(library).toBeVisible();
      await library.getByRole('checkbox', { name: original, exact: true }).click();
      await library.getByRole('button', { name: 'Add selected media', exact: true }).click();
      await expect(library).toBeHidden();
      await expect(page.getByAltText('Profile Picture')).toHaveAttribute('src', new RegExp(file.replace('.', '\\.')));
      const card = page.getByText('Profile', { exact: true }).locator('xpath=ancestor::*[contains(@class,"p-[24px]")][1]');
      await card.getByRole('button', { name: 'Save', exact: true }).click();
      await expect
        .poll(async () => (await (await owner.api.get('/user/personal')).json()).picture?.id)
        .toBe(media.id);
    } finally {
      await owner.remove();
      await prisma.$disconnect();
    }
  });
});
