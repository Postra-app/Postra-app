import { expect, test } from '@playwright/test';

// E2E-06-23: Studio kept only the slide on screen in its draft, and an Undo
// right after switching slides loaded the previous slide's state, which the
// next switch then saved over this slide.
test.use({ viewport: { width: 1440, height: 900 } });

type Draft = { slides?: (string | null)[]; slideIndex?: number; canvasJson: string };
const textsIn = (json: string | null | undefined) =>
  json
    ? ((JSON.parse(json).objects as { type?: string }[]) || []).filter((o) =>
        /text/i.test(o.type || '')
      ).length
    : 0;

test('a carousel draft keeps every slide, and Undo stays on its own slide', async ({ page }) => {
  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /Blank canvas/ }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: /Add text/ }).click();
  await page.getByRole('button', { name: 'Carousel mode' }).click();
  await page.getByTitle('Add an empty slide (max 10)').click();
  await expect(page.getByText('Slide 2 of 2')).toBeVisible();

  // Undo on the new, empty slide, then back to the first one.
  await page.locator('canvas').last().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await page.getByTitle('Go to Slide 1').click();
  await expect(page.getByText('Slide 1 of 2')).toBeVisible();

  const draft = await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    const key = Object.keys(localStorage).find((k) => k.startsWith('postra:studio-draft:'));
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  }) as Draft | null;

  expect(draft?.slides).toHaveLength(2);
  expect(draft?.slideIndex).toBe(0);
  expect(textsIn(draft?.slides?.[0])).toBeGreaterThan(0);
  // Was the first slide's text, copied over by the Undo.
  expect(textsIn(draft?.slides?.[1])).toBe(0);

  // A refresh brings the carousel back, not one slide of it.
  await page.reload();
  await expect(page.getByText('Slide 1 of 2')).toBeVisible({ timeout: 30_000 });
});
