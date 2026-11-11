import { expect, test } from '@playwright/test';

// Lighthouse on production: every page loaded Stripe.js (250 KiB, 74 % unused
// on the calendar) and its m.stripe.com third-party cookie, because the paywall
// component in the layout imported the package entry that injects the script on
// import; and no page had a main landmark. The paywall still loads Stripe when
// it is shown (stripe-blocked.spec).

test('the calendar loads no Stripe.js and has one main landmark', async ({ page }) => {
  const stripe: string[] = [];
  page.on('request', (req) => {
    if (/js\.stripe\.com|m\.stripe\.com/.test(req.url())) stripe.push(req.url());
  });
  await page.goto('/launches');
  await expect(page.getByRole('button', { name: 'Create Post' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(stripe).toEqual([]);
  await expect(page.getByRole('main')).toHaveCount(1);
});

test('the calendar does not download the post editor before it is opened', async ({ page }) => {
  // The menu prefetches every route; a route that imported the composer
  // statically (Agent, Sets) brought ~13 @tiptap packages to every page.
  const editorChunks: string[] = [];
  page.on('response', async (res) => {
    if (res.request().resourceType() !== 'script' || !res.url().includes('/_next/')) return;
    const body = await res.text().catch(() => '');
    if (/ProseMirror|@tiptap/.test(body)) editorChunks.push(res.url().split('/').pop()!);
  });
  await page.goto('/launches');
  await expect(page.getByRole('button', { name: 'Create Post' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3_000); // idle-time prefetch of the menu routes
  expect(editorChunks).toEqual([]);
});

test('the calendar paints without the AI assistant library or the uploader', async ({ page }) => {
  // Real-user LCP on the calendar was 5.7 s at p75: the whole app shell waited
  // for ~0.5 MB (gzip) of CopilotKit, pulled in by a provider around every page
  // that no chat used (the assistant on /agents brings its own), and ~140 KB of
  // Uppy, pulled in by a channel-menu button that only asks for the media box.
  // Each library is recognised by a text only it ships, not by a class name a
  // component may mention.
  const markers = { CopilotKit: 'wrap your app in a `<CopilotKit>`', Uppy: 'youCanOnlyUploadX' };
  const found: string[] = [];
  let painted = false;
  page.on('response', async (res) => {
    if (painted) return; // idle-time prefetch of the menu routes may load /agents
    if (res.request().resourceType() !== 'script' || !res.url().includes('/_next/')) return;
    const body = await res.text().catch(() => '');
    for (const [name, marker] of Object.entries(markers)) {
      if (body.includes(marker)) found.push(`${name}: ${res.url().split('/').pop()}`);
    }
  });
  await page.goto('/launches');
  await expect(page.getByRole('button', { name: 'Create Post' })).toBeVisible();
  painted = true;
  expect(found).toEqual([]);
});
