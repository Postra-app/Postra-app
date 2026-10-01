import { expect, test } from '@playwright/test';

// AI on production with the real OpenAI key, once a night (e2e-canary.yml,
// never at deploy; budget agreed 2026-10-01). A mock cannot catch what has
// actually broken AI here: an SDK or undici upgrade (E2E-01-23), an expired
// key, a model change. Every engine runs: composer rewrite and hashtags, the
// post Creator graph, the Agent in the browser, and on Mondays one Studio
// image.

const TEXT =
  'Postra lets small agencies plan, write and publish social posts for every client from one calendar, with AI help.';

test('AI rewrite (composer "Shorten") answers with new text', async ({ request }) => {
  const res = await request.post('/api/media/ai-edit', {
    data: { text: TEXT, action: 'shorten', platform: 'bluesky' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body: { text?: string } = await res.json();
  expect(body.text?.trim().length, 'rewritten text').toBeGreaterThan(10);
  expect(body.text).not.toBe(TEXT);
});

test('AI hashtag suggestions answer with hashtags', async ({ request }) => {
  const res = await request.post('/api/media/suggest-hashtags', {
    data: { text: TEXT, platform: 'instagram' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body: { hashtags?: string[] } = await res.json();
  expect(body.hashtags?.length, 'hashtags').toBeGreaterThan(0);
});

test('the post Creator runs its whole graph on the real model', async ({ request }) => {
  test.setTimeout(240_000);
  const res = await request.post('/api/posts/generator', {
    data: {
      research: 'Three tips for planning a month of social media posts for a small bakery',
      isPicture: false,
      format: 'one_short',
      tone: 'company',
    },
    timeout: 220_000,
  });
  expect(res.status()).toBe(201);
  const events = (await res.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const nodes = new Set(events.map((e) => e.metadata?.langgraph_node));
  for (const node of ['find-category', 'generate-hook', 'generate-content', 'post-time']) {
    expect(nodes.has(node), node).toBe(true);
  }
  expect(JSON.stringify(events)).not.toMatch(/"error"/);
});

test('the Agent answers "list my channels" with the real channels', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/agents');
  const input = page.getByPlaceholder(/Write your (post|message)/);
  await expect(input).toBeVisible();
  // The page already shows channel names (and "Postra" everywhere), so count:
  // the answer has to add mentions of a real channel that were not there.
  const mentions = page.getByText(/krisbristol|krisrz\.bsky\.social/i);
  const before = await mentions.count();
  await input.fill('List my connected channels. Reply with their names only.');
  await input.press('Enter');
  await expect
    .poll(() => mentions.count(), { timeout: 150_000, intervals: [2_000, 5_000] })
    .toBeGreaterThan(before);
});

test('Studio AI Generate draws a design (weekly: it costs an image credit)', async ({ request }) => {
  test.skip(
    new Date().getUTCDay() !== 1 && !process.env.E2E_AI_IMAGE,
    'Mondays only, or E2E_AI_IMAGE=1'
  );
  test.setTimeout(200_000);
  // The background is cached per prompt; a dated prompt always draws anew.
  const res = await request.post('/api/media/generate-post-design', {
    data: {
      prompt: `A calm flat-lay of a planner and a coffee cup, canary ${new Date().toISOString().slice(0, 10)}`,
      platform: 'instagram-square',
    },
    timeout: 180_000,
  });
  expect(res.status(), await res.text()).toBe(201);
  const design: { backgroundUrl?: string } = await res.json();
  expect(design.backgroundUrl, 'generated background').toBeTruthy();
  const image = await request.get(design.backgroundUrl!);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toMatch(/^image\//);
});
