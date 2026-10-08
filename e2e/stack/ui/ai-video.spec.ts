import { expect, test } from '@playwright/test';
import { openComposer, watchForErrors } from './ui-helpers';

// AI Image and AI Video in the composer's toolbar. Below 1560 px wide (most
// laptops) they were bare icons on divs: no words, no name for a screen
// reader, no keyboard — K. could not find the video button on 2026-10-08.
// The clip itself comes from the fake kie.ai (stack.env KIEAI_API_URL).

test.use({ viewport: { width: 1280, height: 800 } });

test('AI Image and AI Video are labelled buttons on a laptop-width screen', async ({ page }) => {
  const problems = watchForErrors(page);
  await openComposer(page, 'bluesky', 'A post that wants a video');

  for (const name of ['AI Image', 'AI Video']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toContainText(name);
  }

  // Reachable from the keyboard: focus it and press Enter.
  await page.getByRole('button', { name: 'AI Video', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/\d+ video credits left/)).toBeVisible();
  expect(problems).toEqual([]);
});

test('a clip generated from the composer is attached to the post', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = watchForErrors(page);
  await openComposer(page, 'bluesky', 'A post that wants a video');

  const left = async () =>
    (await (await page.request.get('/api/copilot/credits?type=ai_videos')).json()).credits as number;
  const before = await left();

  await page.getByRole('button', { name: 'AI Video', exact: true }).click();
  // The video counter, not the image one (they shared an SWR key with the
  // Studio's image generator).
  await expect(page.getByText(`${before} video credits left`)).toBeVisible();
  await page.getByLabel('Prompt').fill(`A paper boat on a puddle ${Date.now()}`);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  await expect(page.locator('.sortable-container video, .sortable-container [src$=".mp4"]').first()).toBeAttached({
    timeout: 30_000,
  });
  expect(await left()).toBe(before - 1);
  expect(problems).toEqual([]);
});

test('Billing shows the AI images and videos left this month', async ({ page }) => {
  const problems = watchForErrors(page);
  const left = async (type: string) =>
    (await (await page.request.get(`/api/copilot/credits?type=${type}`)).json()).credits as number;
  await page.goto('/billing');
  const usage = page.getByRole('region', { name: 'This month' });
  await expect(usage).toContainText(`${await left('ai_images')} of 200 AI images left`);
  await expect(usage).toContainText(`${await left('ai_videos')} of 30 AI videos left`);
  expect(problems).toEqual([]);
});
