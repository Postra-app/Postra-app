import { APIRequestContext, expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// An AI image end to end, on the fake OpenAI (its /v1/images answers like
// gpt-image): one credit per picture, the file in the media library marked as
// AI-made, a row in the usage log — and a prompt the safety filter refuses
// costs nothing and says why (P5 #8, #16).

const prisma = database();
test.afterAll(() => prisma.$disconnect());

const imagesLeft = async (api: APIRequestContext) =>
  (await (await api.get('/copilot/credits?type=ai_images')).json()).credits as number;

test('an AI image costs one credit, lands in the library as AI-made and is metered', async () => {
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    const before = await imagesLeft(pro.api);
    const prompt = `A red bicycle against a white wall ${Date.now()}`;
    const res = await pro.api.post('/media/generate-image-with-prompt', { data: { prompt } });
    expect(res.status(), await res.text()).toBe(201);
    const { id, path } = await res.json();
    expect(path).toBeTruthy();

    expect(await imagesLeft(pro.api)).toBe(before - 1);
    const media = await prisma.media.findUniqueOrThrow({ where: { id } });
    expect(media.organizationId).toBe(pro.orgId);
    expect(media.aiGenerated).toBe(true);
    const usage = await prisma.aiUsage.findMany({
      where: { organizationId: pro.orgId, unit: 'images' },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ engine: 'media', inputAmount: 1 });
    // The prompt reached the fake (rewritten by the model first) — and this is
    // the counter the no-plan test below relies on to see nothing.
    const seen = await pro.api.get(`http://localhost:58090/__seen?text=${encodeURIComponent(prompt)}`);
    expect((await seen.json()).count).toBeGreaterThan(0);
  } finally {
    await pro.remove();
  }
});

test('a prompt the safety filter refuses: 422 with the reason, and the credit is kept', async () => {
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    const before = await imagesLeft(pro.api);
    // /generate-image sends the prompt as typed (the -with-prompt route has the
    // model rewrite it first, which the fake answers with fixed text).
    const res = await pro.api.post('/media/generate-image', {
      data: { prompt: 'stack-refuse this one' },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).message).toContain('refused by the image safety filter');
    expect(await imagesLeft(pro.api)).toBe(before);
    expect(await prisma.media.count({ where: { organizationId: pro.orgId } })).toBe(0);
    expect(
      await prisma.aiUsage.count({ where: { organizationId: pro.orgId, unit: 'images' } })
    ).toBe(0);
  } finally {
    await pro.remove();
  }
});

// No plan, no AI: every route that reaches a model refuses an organisation
// without a subscription before anything is sent to OpenAI (P5 #17; the
// client hides these behind tier.ai, media.controller.ai-gates.spec checks the
// decorators — this checks what they do).
test('an organisation without a plan gets 402 from every AI route, and OpenAI hears nothing', async () => {
  const free = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  await prisma.subscription.deleteMany({ where: { organizationId: free.orgId } });
  const marker = `no-plan-${Date.now()}`;
  try {
    for (const [route, data] of [
      ['/media/generate-image', { prompt: marker }],
      ['/media/generate-image-with-prompt', { prompt: marker }],
      ['/media/generate-post-design', { prompt: marker, platform: 'instagram' }],
      ['/media/generate-carousel-design', { prompt: marker, platform: 'instagram', slides: 3 }],
      ['/media/suggest-hashtags', { text: marker }],
      ['/media/brand-voice-check', { text: marker }],
      ['/media/search-templates', { query: marker }],
    ] as const) {
      expect((await free.api.post(route, { data })).status(), route).toBe(402);
    }
    const seen = await free.api.get(`http://localhost:58090/__seen?text=${marker}`);
    expect((await seen.json()).count).toBe(0);
  } finally {
    await free.remove();
  }
});
