import { expect, test } from '@playwright/test';

// AI on production with the real OpenAI key, once a night (e2e-canary.yml,
// never at deploy). A mock cannot catch what has actually broken AI here: an
// SDK or undici upgrade (E2E-01-23), an expired key, a model change. Two of the
// cheapest calls the composer makes — a few hundred tokens a night.

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
