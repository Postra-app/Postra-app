import { expect, test } from '@playwright/test';

// Both tests change the same user's profile.
test.describe.configure({ mode: 'serial' });

// K21 (2026-10-10): the web app had no way to change your name, bio or
// picture — the settings form loaded and saved them but showed no fields.
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

// Codex review 10-10: the media library hands back a list of chosen files,
// and the card read an id and path from the list itself, so a chosen picture
// never showed and saving sent an empty one.
test('a picture chosen from the library shows and is saved', async ({ page }) => {
  test.setTimeout(60_000);
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const res = await page.request.post('/api/media/upload-simple', {
    multipart: { file: { name: `profile-${Date.now()}.png`, mimeType: 'image/png', buffer: PNG } },
  });
  expect(res.status(), await res.text()).toBe(201);
  const media: { id: string; path: string } = await res.json();
  try {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Choose picture', exact: true }).click();
    // The library lists the newest first; ours was just uploaded.
    // The app's top bar overlaps the first row of tiles in the test window.
    await page.locator('div.w-full.aspect-square').first().dispatchEvent('click');
    await page.getByRole('button', { name: 'Add selected media', exact: true }).click();
    const file = media.path.split('/').pop()!;
    await expect(page.getByAltText('Profile Picture')).toHaveAttribute('src', new RegExp(file.replace('.', '\\.')));
    const card = page.getByText('Profile', { exact: true }).locator('xpath=ancestor::*[contains(@class,"p-[24px]")][1]');
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(async () => (await (await page.request.get('/api/user/personal')).json()).picture?.id)
      .toBe(media.id);
  } finally {
    const personal = await (await page.request.get('/api/user/personal')).json();
    // picture: null takes the picture off again; other specs share this user.
    await page.request.post('/api/user/personal', { data: { fullname: personal.name || 'Stack User', bio: personal.bio || '', picture: null } });
  }
});
