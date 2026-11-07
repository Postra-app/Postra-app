import { expect, test } from '@playwright/test';
import { openComposer, watchForErrors } from './ui-helpers';

// AI Image and AI Video in the composer's toolbar. Below 1560 px wide (most
// laptops) they were bare icons on divs: no words, no name for a screen reader,
// no keyboard, and the video button was hard to find. The clip itself comes
// from the fake kie.ai (stack.env KIEAI_API_URL).

test.use({ viewport: { width: 1280, height: 800 } });
// Both video tests spend credits of the same organisation and read the count.
test.describe.configure({ mode: 'serial' });

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
  // The picture picker of the video window offered AI Video too —
  // a video cannot be one of the pictures the clip is made from.
  const pictures = page.locator('form').filter({ hasText: 'Images (max 3)' });
  await expect(pictures.getByRole('button', { name: 'AI Image', exact: true })).toBeVisible();
  await expect(pictures.getByRole('button', { name: 'AI Video', exact: true })).toHaveCount(0);
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

// The load balancer gives up after three minutes and a clip can take longer:
// the clip was made, paid for and saved, but the browser got a 504, showed "server unavailable" and the post never got the
// clip. Now the composer says it is still being made, asks where it stands
// (a read that never makes a clip) and attaches it when it is ready.
test('a clip that outlasts the load balancer still lands in the post', async ({ page }) => {
  test.setTimeout(90_000);
  await openComposer(page, 'bluesky', 'A post that waits for its video');
  const left = async () =>
    (await (await page.request.get('/api/copilot/credits?type=ai_videos')).json()).credits as number;
  const before = await left();
  await page.route('**/api/media/generate-video', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    // The clip is made on the server; the browser only hears the gateway.
    await route.fetch();
    return route.fulfill({ status: 504, contentType: 'text/html', body: '<html>504</html>' });
  });
  let asked = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/media/generate-video/result')) asked += 1;
  });

  await page.getByRole('button', { name: 'AI Video', exact: true }).click();
  await page.getByLabel('Prompt').fill(`A kite over a beach ${Date.now()}`);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  await expect(page.getByText('Your video is taking longer than usual')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('The server is temporarily unavailable')).toHaveCount(0);
  await expect(page.locator('.sortable-container video, .sortable-container [src$=".mp4"]').first()).toBeAttached({
    timeout: 60_000,
  });
  await expect(page.getByText('Video created and saved to your media library.')).toBeVisible();
  expect(asked).toBeGreaterThanOrEqual(1);
  expect(await left()).toBe(before - 1);
});

// After the gateway gave up, a clip the model then failed left "taking
// longer" on screen for good: the window stopped asking without a word.
test('a clip that fails after the gateway gave up says so', async ({ page }) => {
  test.setTimeout(60_000);
  await openComposer(page, 'bluesky', 'A post whose video fails late');
  await page.route('**/api/media/generate-video', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch();
    return route.fulfill({ status: 504, contentType: 'text/html', body: '<html>504</html>' });
  });
  await page.getByRole('button', { name: 'AI Video', exact: true }).click();
  await page.getByLabel('Prompt').fill(`stack-kie-fail A lighthouse at dusk ${Date.now()}`);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByText('Your video is taking longer than usual')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Could not generate the video, please try again.')).toBeVisible({
    timeout: 30_000,
  });
});

test('Billing shows the AI images and videos left this month', async ({ page }) => {
  // The plan cards ask Stripe for an upgrade quote a moment after the page
  // renders; the stack's Stripe key is fake, so that quote is a 502 that
  // landed in `problems` whenever the page was slower than the debounce (CI,
  // 2026-10-17 twice). The quote is not what this test is about.
  await page.route('**/api/billing/prorate', (route) => route.fulfill({ json: { price: 10 } }));
  const problems = watchForErrors(page);
  const left = async (type: string) =>
    (await (await page.request.get(`/api/copilot/credits?type=${type}`)).json()).credits as number;
  const usage = page.getByRole('region', { name: 'This month' });
  // Other workers spend this user's credits in parallel: a count read after
  // the page rendered can already be one lower (seen 2026-10-15 in a full
  // local stack run). Page and count are read together until they agree.
  await expect(async () => {
    await page.goto('/billing');
    await expect(usage).toContainText(`${await left('ai_images')} of 200 AI images left`, {
      timeout: 3_000,
    });
    await expect(usage).toContainText(`${await left('ai_videos')} of 30 AI videos left`, {
      timeout: 3_000,
    });
  }).toPass({ timeout: 20_000 });
  expect(problems).toEqual([]);
});

// On production a clip took about 2 min 45 s. The browser gave up after 2 min
// (the shared fetch timeout) and said "Could not generate the video, please try
// again" while the clip was made, paid for and saved to the library - trying
// again would have paid twice.
test('a clip that takes longer than two minutes still arrives, without an error', async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.install();
  await openComposer(page, 'bluesky', 'A post that wants a slow video');

  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  let seen = false;
  await page.route('**/api/media/generate-video', async (route) => {
    seen = true;
    await held;
    const response = await route.fetch();
    await route.fulfill({ response });
  });

  await page.getByRole('button', { name: 'AI Video', exact: true }).click();
  await page.getByLabel('Prompt').fill(`A slow paper boat ${Date.now()}`);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(() => seen).toBe(true);

  await page.clock.fastForward('02:10');
  await page.waitForTimeout(500);
  release();

  await expect(page.locator('.sortable-container video, .sortable-container [src$=".mp4"]').first()).toBeAttached({
    timeout: 30_000,
  });
  await expect(page.getByText('Could not generate the video', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Video created and saved to your media library.')).toBeVisible();
});
