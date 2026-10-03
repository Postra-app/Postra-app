import { expect, test } from '@playwright/test';
import { channels, promo, settingsFor } from './publish.helpers';

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

// Ghost text (CopilotKit autosuggestions) in the signature editor. It is the
// only AI here that streams through CopilotKit's own OpenAI client, metered
// as `autocomplete` in AiUsage; on 2026-10-03 that engine had 0 rows, so this
// proves the feature answers at all. Nothing is saved: the modal is closed.
test('ghost text suggests a continuation in the signature editor', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/settings');
  await page.getByRole('tab', { name: /signatures/i }).click();
  await page.getByRole('button', { name: /add( a)? signature/i }).click();
  const editor = page.locator('[contenteditable="true"]').last();
  await expect(editor).toBeVisible();
  const answered = page.waitForResponse(
    (r) => r.url().includes('/copilot/chat') && r.request().method() === 'POST',
    { timeout: 60_000 }
  );
  await editor.click();
  await page.keyboard.type('Thanks for reading! Plan your next post with', { delay: 40 });
  const res = await answered;
  expect(res.status()).toBe(200);
  // A multipart GraphQL stream: the suggestion arrives as word chunks after
  // the opening TextMessageOutput.
  const body = await res.text();
  expect(body).toContain('TextMessageOutput');
  expect(body).toMatch(/"content",\d+\]/);
  expect(body).not.toMatch(/"errors"/);
});

// The Agent's destructive tools only park an action; a person approves it on
// a card in the chat (P5 #11). On a draft of a technical channel: Decline
// leaves the post, Approve deletes it, and the same token a second time is
// 410. The draft is deleted in `finally` if anything fails on the way.
test('the Agent deletes a post only after Approve on its card', async ({ page, request }) => {
  test.setTimeout(300_000);
  const telegram = (await channels(request)).find((c) => c.identifier === 'telegram');
  expect(telegram, 'a Telegram channel').toBeTruthy();
  const content = promo(1);
  const date = new Date(Date.now() + 5 * 86_400_000);
  const created = await request.post('/api/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: date.toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: telegram!.id },
          value: [{ content, image: [] }],
          settings: await settingsFor(request, telegram!),
        },
      ],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const [{ postId }] = await created.json();
  const { group } = await (await request.get(`/api/posts/${postId}`)).json();
  expect(group, 'group of the draft').toBeTruthy();
  const exists = async () => (await request.get(`/api/posts/group/${group}`)).status() === 200;

  try {
    await page.goto('/agents');
    const input = page.getByPlaceholder(/Write your (post|message)/);
    await expect(input).toBeVisible();
    // Enter does nothing while the Agent is still answering, so keep
    // pressing until the message has left the box.
    const ask = async () => {
      await input.fill(`Delete the post whose group id is ${group}. Use the deletePost tool.`);
      await expect(async () => {
        await input.press('Enter');
        await expect(input).toHaveValue('', { timeout: 2_000 });
      }).toPass({ timeout: 120_000 });
    };

    await ask();
    const decline = page.getByRole('button', { name: 'Decline' }).last();
    await expect(decline).toBeVisible({ timeout: 150_000 });
    const declined = page.waitForResponse((r) => /\/copilot\/pending\/[^/]+\/decline/.test(r.url()));
    await decline.click();
    expect((await declined).status()).toBe(201);
    expect(await exists(), 'declined: the post is still there').toBe(true);

    await ask();
    const approve = page.getByRole('button', { name: 'Approve' }).last();
    await expect(approve).toBeEnabled({ timeout: 150_000 });
    const approved = page.waitForResponse((r) => /\/copilot\/pending\/[^/]+\/approve/.test(r.url()));
    await approve.click();
    const res = await approved;
    expect(res.status()).toBe(201);
    await expect.poll(exists, { timeout: 15_000 }).toBe(false);

    const again = await request.post(new URL(res.url()).pathname);
    expect(again.status(), 'a used token').toBe(410);
  } finally {
    if (await exists()) await request.delete(`/api/posts/${group}`);
  }
});
