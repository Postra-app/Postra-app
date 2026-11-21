import { expect, Page, test } from '@playwright/test';
import sharp from 'sharp';
import { inOwnOrganisation } from './studio-helpers';
import { watchForErrors } from './ui-helpers';

// Studio → Photos: the level chosen is the level the server is asked for,
// holding the picture shows the original, and a batch stops at ten photos.
// In a throwaway organisation: every retouch and the eleven photos of the cap
// test land in its library. studio-photos.spec.ts covers the round trip.

test.use({ viewport: { width: 1440, height: 900 } });

const photo = (shade: number) =>
  sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: shade, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();

const upload = async (page: Page, name: string, shade = 60) => {
  const res = await page.request.post('/api/media/upload-simple', {
    multipart: { file: { name, mimeType: 'image/jpeg', buffer: await photo(shade) } },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; path: string };
};

const openWith = async (page: Page, id: string) => {
  await page.goto(`/studio?mode=photo&mediaId=${id}`);
  await expect(page.getByTestId('retouch-item')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText('Ready to retouch')).toBeVisible();
};

test.describe('in its own organisation', () => {
  inOwnOrganisation();

  for (const [label, level] of [
    ['Light', 'light'],
    ['Medium', 'medium'],
    ['Strong', 'strong'],
    ['Black & white', 'bw'],
  ] as const) {
    test(`Photos: ${label} is the level the retouch asks for and the result shows`, async ({ page }) => {
      const problems = watchForErrors(page);
      const source = await upload(page, `level-${level}-${Date.now()}.jpg`);
      await openWith(page, source.id);
      // Another level first, so the click below is what decides.
      const other = level === 'light' ? 'Strong' : 'Light';
      await page.getByRole('radio', { name: other }).click();
      await page.getByRole('radio', { name: label }).click();
      await expect(page.getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'true');

      const sent = page.waitForRequest((r) => r.url().endsWith(`/media/${source.id}/retouch`));
      await page.getByRole('button', { name: 'Retouch all', exact: true }).click();
      expect((await sent).postDataJSON()).toEqual({ level });
      const item = page.getByTestId('retouch-item');
      await expect(item).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
      await expect(item.getByTestId('retouch-level-badge')).toHaveText(label);
      expect(problems).toEqual([]);
    });
  }

  test('Photos: holding the picture shows the original, letting go shows the retouched one', async ({ page }) => {
    const problems = watchForErrors(page);
    const source = await upload(page, `hold-${Date.now()}.jpg`);
    await openWith(page, source.id);
    const done = page.waitForResponse((r) => r.url().endsWith(`/media/${source.id}/retouch`));
    await page.getByRole('button', { name: 'Retouch all', exact: true }).click();
    const result = (await (await done).json()) as { path: string };
    const item = page.getByTestId('retouch-item');
    await expect(item).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    const picture = item.locator('img');
    await expect(picture).toHaveAttribute('src', result.path);

    // A real press and release, the way a finger or a mouse holds it.
    const box = (await item.getByTitle('Hold to see the original').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(picture).toHaveAttribute('src', source.path);
    await expect(item.getByTestId('retouch-level-badge')).toHaveText('Original');
    await page.mouse.up();
    await expect(picture).toHaveAttribute('src', result.path);
    await expect(item.getByTestId('retouch-level-badge')).toHaveText('Light');
    expect(problems).toEqual([]);
  });

  test('Photos: an eleventh photo is left out, and the batch says so', async ({ page }) => {
    test.setTimeout(90_000);
    const problems = watchForErrors(page);
    const stamp = Date.now();
    const names: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      names.push(`cap-${stamp}-${i}.jpg`);
      await upload(page, names[i], 30 + i * 15);
    }
    await page.goto('/studio?mode=photo');
    await page.getByRole('button', { name: 'Add photos', exact: true }).first().click({ timeout: 30_000 });
    for (const name of names) {
      const tile = page.getByRole('checkbox', { name, exact: true });
      await tile.click();
      await expect(tile).toHaveAttribute('aria-checked', 'true');
    }
    await page.getByRole('button', { name: 'Add selected media', exact: true }).click();
    await expect(page.getByText('Up to 10 photos at a time. The extra ones were left out.')).toBeVisible();
    await expect(page.getByTestId('retouch-item')).toHaveCount(10);
    await expect(page.getByRole('button', { name: 'Add photos', exact: true })).toBeDisabled();
    expect(problems).toEqual([]);
  });
});
