import { expect, Page, test } from '@playwright/test';
import { openComposer } from './ui-helpers';

// Studio losing work. Each of these used to drop a design, slides or a brand kit
// without asking.
test.use({ viewport: { width: 1440, height: 900 } });

const draft = (page: Page) =>
  page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    const key = Object.keys(localStorage).find((k) => k.startsWith('postra:studio-draft:'));
    return key ? localStorage.getItem(key) : null;
  });

const studioFromComposer = async (page: Page) => {
  await openComposer(page, 'bluesky', 'A graphic that must not get lost');
  const editor = page.getByRole('dialog', { name: 'Post editor' });
  await editor.getByRole('button', { name: 'Studio', exact: true }).click();
  await page.getByText('Blank canvas').click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: /Add text/ }).click();
  await expect.poll(() => draft(page)).not.toBeNull();
  return editor;
};

// With the library full the upload answered 402; "Use in post" went on with
// no file: Studio closed, the draft was deleted and the post got an empty
// attachment.
test('a refused upload keeps Studio, the design and its draft', async ({ page }) => {
  const editor = await studioFromComposer(page);
  await page.route('**/api/media/upload-simple', (route) =>
    route.fulfill({ status: 402, json: { message: 'Your media library is full.' } })
  );
  await page.getByRole('button', { name: 'Use in post' }).click();
  await page.getByRole('button', { name: 'No, cancel!' }).click();
  await expect(page.getByText('The design was not added. It is still here, so you can try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use in post' })).toBeVisible();
  expect(await draft(page)).not.toBeNull();
  await expect(editor.locator('img[src*="/uploads/"], img[src*="cdn"]')).toHaveCount(0);
});

// Escape is "deselect" in Studio, and a drag that ends off the canvas lands on
// the backdrop: both closed Studio opened from the composer.
test('Escape and a click on the backdrop do not close Studio', async ({ page }) => {
  await studioFromComposer(page);
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(page.getByRole('button', { name: 'Use in post' })).toBeVisible();
});

const carousel = async (page: Page) => {
  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Blank canvas/ }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: /Add text/ }).click();
  await page.getByRole('button', { name: 'Carousel mode' }).click();
  await page.getByTitle('Add an empty slide (max 10)').click();
  await page.getByTitle('Add an empty slide (max 10)').click();
  await expect(page.getByText('Slide 3 of 3')).toBeVisible();
};

// "Save to library" in a carousel saved the slide on screen and deleted the
// draft of the whole carousel: after a reload the other slides were gone.
test('saving one slide of a carousel keeps the carousel', async ({ page }) => {
  await carousel(page);
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.getByText(/^Save (this slide )?to library$/).click();
  await expect(page.getByText('Saved to media library - you can use it in any post.')).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Slide \d of 3/)).toBeVisible({ timeout: 30_000 });
});

// "Apply layout" wrote the current slide over all the others, and "Exit" and
// a slide's cross dropped slides, all without a question.
test('replacing or dropping slides asks first', async ({ page }) => {
  await carousel(page);
  await page.getByRole('button', { name: 'Copy this slide to all' }).click();
  await expect(page.getByText('Copy this slide to all slides?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.getByText('Leave carousel mode?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Delete this slide' }).first().click();
  await expect(page.getByText('Delete Slide 1?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText(/Slide \d of 3/)).toBeVisible();
  const box = (await page.getByRole('button', { name: 'Delete this slide' }).first().boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(24);
});

// A failed read of the brand kit showed the defaults as if saved, and the
// first change wrote them over the real kit.
test('a brand kit that could not be read is not overwritten', async ({ page }) => {
  const puts: string[] = [];
  await page.route('**/api/brand-kit', (route) => {
    if (route.request().method() === 'PUT') {
      puts.push('PUT');
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ status: 502, body: 'Bad gateway' });
  });
  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Blank canvas/ }).click();
  await page.getByRole('button', { name: 'Brand Kit', exact: true }).first().click();
  await expect(page.getByText('Could not load your brand kit. Nothing has been changed.')).toBeVisible();
  await expect(page.locator('input[type="color"]')).toHaveCount(0);
  expect(puts).toEqual([]);
});

// Selecting text in a field and letting go outside the window closed the
// window with what was typed.
test('a text selection dragged out of a window does not close it', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Webhooks' }).click({ timeout: 20_000 });
  await page.getByRole('button', { name: /Add a webhook/i }).click();
  const field = page.getByRole('dialog').locator('input').first();
  await field.fill('My webhook name that is long');
  const box = (await field.boundingBox())!;
  await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(field).toHaveValue('My webhook name that is long');
});

// A design the browser cannot keep (too large, or storage full) showed only a
// small yellow "Not autosaved", and closing the tab took it without a word.
test('a design the browser cannot keep says so, and closing the tab asks first', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('postra:studio-draft:')) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Blank canvas/ }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: /Add text/ }).click();
  // The text lands on the canvas a moment after the click: snapshot until it
  // is there (the editor does it every 30 s on its own).
  const banner = page.getByRole('alert').filter({ hasText: 'Save it to your library' });
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      return banner.isVisible();
    })
    .toBe(true);

  let asked = '';
  page.on('dialog', async (dialog) => {
    asked = dialog.type();
    await dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => asked).toBe('beforeunload');
});

test('saving the design to the library quiets the warning', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('postra:studio-draft:')) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Blank canvas/ }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: /Add text/ }).click();
  const banner = page.getByRole('alert').filter({ hasText: 'Save it to your library' });
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      return banner.isVisible();
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.getByText(/^Save (this slide )?to library$/).click();
  await expect(page.getByText('Saved to media library - you can use it in any post.')).toBeVisible();
  await expect(banner).toHaveCount(0);
});

// "Edit in Studio" on another file wrote over the unfinished design in the
// draft on its first autosave, without a word.
test('opening a file in Studio keeps the unfinished design', async ({ page }) => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  const uploaded = await page.request.post('/api/media/upload-simple', {
    multipart: { file: { name: `edit-in-studio-${Date.now()}.png`, mimeType: 'image/png', buffer: PNG } },
  });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const media: { id: string } = await uploaded.json();

  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Blank canvas/ }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: /Add text/ }).click();
  // The text lands on the canvas a moment after the click.
  await expect.poll(() => draft(page)).not.toBeNull();
  const unfinished = await draft(page);

  await page.goto(`/studio?mediaId=${media.id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const kept = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(
      (k) => k.startsWith('postra:studio-draft:') && !k.includes(':media:')
    );
    return keys.length === 1 ? localStorage.getItem(keys[0]) : `keys: ${keys.join(',')}`;
  });
  expect(kept).toBe(unfinished);
});

// A carousel saves only the slide on screen to the library: the warning about
// a design the browser cannot keep stays, the other slides live nowhere else.
test('saving one slide of a carousel keeps the warning while the browser cannot keep it', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('postra:studio-draft:')) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await carousel(page);
  const banner = page.getByRole('alert').filter({ hasText: 'Save it to your library' });
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      return banner.isVisible();
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.getByText(/^Save (this slide )?to library$/).click();
  await expect(page.getByText('Saved to media library - you can use it in any post.')).toBeVisible();
  await expect(banner).toBeVisible();
});
