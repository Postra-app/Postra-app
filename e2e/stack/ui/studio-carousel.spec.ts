import { expect, Page, test } from '@playwright/test';
import { design, studio, Studio, types } from './studio-helpers';

// What the carousel's slide actions do to the slides, once the user has said
// yes (studio-safety.spec.ts checks that each of them asks first). Every
// slide is told apart by what is on it: a text, a rectangle, a circle.

test.use({ viewport: { width: 1440, height: 900 } });

/** The types on each slide, from the draft (the live canvas stands in for
 *  the slide on screen). */
const slides = async (page: Page) => {
  const d = await design(page);
  return (d?.slides ?? []).map((json) =>
    json ? (JSON.parse(json).objects as { type: string }[]).map((o) => o.type.toLowerCase()) : []
  );
};

const threeSlides = async (page: Page): Promise<Studio> => {
  const s = await studio(page);
  await s.tool('Text').click();
  await expect.poll(() => types(page)).toEqual(['textbox']);
  await page.getByRole('button', { name: 'Carousel mode' }).click();
  await page.getByTitle('Add an empty slide (max 10)').click();
  await expect(page.getByText('Slide 2 of 2')).toBeVisible();
  await s.addShape(/Rectangle/i, 'rect');
  await page.getByTitle('Add an empty slide (max 10)').click();
  await expect(page.getByText('Slide 3 of 3')).toBeVisible();
  await s.addShape(/Circle/i, 'circle');
  await expect.poll(() => slides(page)).toEqual([['textbox'], ['rect'], ['circle']]);
  return s;
};

const confirm = (page: Page, title: string, button: string) =>
  page.getByRole('dialog').filter({ hasText: title }).getByRole('button', { name: button, exact: true }).click();

test('Copy this slide to all makes every slide a copy of the one on screen', async ({ page }) => {
  const s = await threeSlides(page);
  await page.getByRole('button', { name: 'Go to Slide 1', exact: true }).click();
  await expect(page.getByText('Slide 1 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Copy this slide to all' }).click();
  await confirm(page, 'Copy this slide to all slides?', 'Copy to all slides');
  await expect.poll(() => slides(page)).toEqual([['textbox'], ['textbox'], ['textbox']]);
  // The same design, not just the same kind of layer.
  const [first, ...rest] = ((await design(page))?.slides ?? []).map((json) => JSON.parse(json!).objects);
  for (const other of rest) expect(other).toEqual(first);
  // And it is what the other slides now show.
  await page.getByRole('button', { name: 'Go to Slide 3', exact: true }).click();
  await expect(page.getByText('Slide 3 of 3')).toBeVisible();
  await expect.poll(() => types(page)).toEqual(['textbox']);
  await s.clean();
});

test('Delete this slide removes that slide and keeps the others', async ({ page }) => {
  const s = await threeSlides(page);
  await page.getByRole('button', { name: 'Delete this slide', exact: true }).nth(1).click();
  await confirm(page, 'Delete Slide 2?', 'Delete this slide');
  await expect(page.getByText('Slide 2 of 2')).toBeVisible();
  await expect.poll(() => slides(page)).toEqual([['textbox'], ['circle']]);
  // The slide on screen is still the circle.
  expect(await types(page)).toEqual(['circle']);
  await s.clean();
});

test('Exit, Leave and delete the other slides, leaves the slide on screen as the only canvas', async ({ page }) => {
  const s = await threeSlides(page);
  await page.getByRole('button', { name: 'Go to Slide 2', exact: true }).click();
  await expect(page.getByText('Slide 2 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Exit', exact: true }).click();
  await confirm(page, 'Leave carousel mode?', 'Leave and delete the other slides');
  await expect(page.getByRole('button', { name: 'Carousel mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Go to Slide \d+$/ })).toHaveCount(0);
  await expect.poll(async () => (await design(page))?.slides).toBeUndefined();
  expect(await types(page)).toEqual(['rect']);
  await s.clean();
});
