import { expect, test } from '@playwright/test';
import { colourfulness, design, FabricObject, inOwnOrganisation, pixel, studio } from './studio-helpers';

// What the image tools do to the photo itself: the part of it a crop keeps,
// and the pixels a filter paints. The photo is 640x480, blue with a yellow
// circle.

test.use({ viewport: { width: 1440, height: 900 } });

const image = async (page: import('@playwright/test').Page) =>
  ((await design(page))?.canvas.objects ?? []).find((o) => o.type.toLowerCase() === 'image') as
    | FabricObject
    | undefined;
const cropWindow = async (page: import('@playwright/test').Page) => {
  const img = await image(page);
  return img && { cropX: img.cropX, cropY: img.cropY, width: img.width, height: img.height };
};

test.describe('in its own organisation', () => {
  inOwnOrganisation();

  test('Crop by hand keeps the part inside the frame, Reset crop shows the whole photo again', async ({
    page,
  }) => {
    const s = await studio(page);
    await s.uploadPhoto();
    expect(await cropWindow(page)).toEqual({ cropX: 0, cropY: 0, width: 640, height: 480 });

    await page.getByRole('button', { name: 'Crop by hand' }).click();
    await expect(page.getByText('Drag the frame over the part you want to keep, then apply.')).toBeVisible();
    // The frame starts on the middle 80 % of the photo (512x384 from 64,48);
    // its 2 px outline counts as inside.
    await page.getByRole('button', { name: 'Apply crop', exact: true }).click();
    await expect.poll(async () => (await cropWindow(page))?.width).toBeLessThan(640);
    const kept = (await cropWindow(page))!;
    expect(Math.abs(Number(kept.cropX) - 64)).toBeLessThanOrEqual(2);
    expect(Math.abs(Number(kept.cropY) - 48)).toBeLessThanOrEqual(2);
    expect(Math.abs(Number(kept.width) - 512)).toBeLessThanOrEqual(2);
    expect(Math.abs(Number(kept.height) - 384)).toBeLessThanOrEqual(2);
    await expect(page.getByRole('button', { name: 'Crop by hand' })).toBeVisible();
    // The frame was a helper; it is not part of the design.
    expect(((await design(page))?.canvas.objects ?? []).map((o) => o.type.toLowerCase())).toEqual(['image']);

    await page.getByRole('button', { name: 'Reset crop' }).click();
    await expect.poll(() => cropWindow(page)).toEqual({ cropX: 0, cropY: 0, width: 640, height: 480 });
    await s.clean();
  });

  test('a filter changes the pixels of the photo, Reset filters brings them back', async ({ page }) => {
    const s = await studio(page);
    await s.uploadPhoto();
    // The middle of the canvas is the photo's yellow circle.
    const middle = async () => {
      const [r, g, b] = await pixel(page, 0.5, 0.5);
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    // The photo is drawn a moment after it joins the design.
    await expect.poll(middle).toBeGreaterThan(120);
    const before = { middle: await middle(), all: await colourfulness(page) };

    await page.getByRole('button', { name: 'B&W', exact: true }).click();
    await expect.poll(async () => (await image(page))?.filters).toEqual([expect.objectContaining({ type: 'Grayscale' })]);
    // Grey: no colour left in the photo.
    await expect.poll(middle).toBeLessThan(6);
    expect(await colourfulness(page)).toBeLessThan(before.all * 0.5);

    await page.getByRole('button', { name: 'Reset filters' }).click();
    await expect.poll(async () => (await image(page))?.filters).toEqual([]);
    await expect.poll(async () => Math.abs((await middle()) - before.middle)).toBeLessThan(4);
    expect(Math.abs((await colourfulness(page)) - before.all)).toBeLessThan(2);
    await s.clean();
  });
});
