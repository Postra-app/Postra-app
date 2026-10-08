import { APIRequestContext, expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// AI video end to end on the fake kie.ai (fake-openai.mjs, stack.env
// KIEAI_API_URL): the monthly clips each plan gets, one credit per clip, the
// file in the media library, the cost in the usage log (for the margin
// guard), a failed clip costs nothing, and a double click pays once.

const prisma = database();
test.afterAll(() => prisma.$disconnect());

const videosLeft = async (api: APIRequestContext) =>
  (await (await api.get('/copilot/credits?type=ai_videos')).json()).credits as number;

const kieTasks = async (api: APIRequestContext, marker: string) =>
  ((await (await api.get('http://localhost:58090/__requests')).json()) as any[]).filter(
    (r) => r.path === '/api/v1/jobs/createTask' && String(r.input?.prompt).includes(marker)
  );

const generate = (api: APIRequestContext, prompt: string, output = 'vertical') =>
  api.post('/media/generate-video', {
    data: { type: 'veo3', output, customParams: { prompt, images: [] } },
  });

test('clips per month: Starter 15, Pro 30, Business 60, a trial 1', async () => {
  for (const [tier, isTrailing, clips] of [
    ['STANDARD', false, 15],
    ['PRO', false, 30],
    ['ULTIMATE', false, 60],
    ['ULTIMATE', true, 1],
  ] as const) {
    const org = await throwawayOrg(prisma, { tier, totalChannels: 3, channels: 0, isTrailing });
    try {
      expect(await videosLeft(org.api), `${tier}${isTrailing ? ' trial' : ''}`).toBe(clips);
    } finally {
      await org.remove();
    }
  }
});

test('a clip costs one credit, lands in the library as AI-made and is metered', async () => {
  const starter = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    expect(await videosLeft(starter.api)).toBe(15);
    expect((await starter.api.get('/media/video-options')).status()).toBe(200);
    const options = await (await starter.api.get('/media/video-options')).json();
    expect(options.map((o: any) => o.identifier)).toContain('veo3');

    const prompt = `A barista pours latte art in slow motion ${Date.now()}`;
    const res = await generate(starter.api, prompt);
    expect(res.status(), await res.text()).toBe(201);
    const { id, path } = await res.json();
    expect(path).toMatch(/\.mp4$/);

    expect(await videosLeft(starter.api)).toBe(14);
    const media = await prisma.media.findUniqueOrThrow({ where: { id } });
    expect(media.organizationId).toBe(starter.orgId);
    expect(media.aiGenerated).toBe(true);

    // What kie.ai was asked for: Veo 3.1 Fast, vertical, text only.
    const [task] = await kieTasks(starter.api, prompt);
    expect(task.model).toBe('veo-3-1');
    expect(task.input).toMatchObject({
      prompt,
      model: 'veo3_fast',
      aspect_ratio: '9:16',
      generation_type: 'TEXT_2_VIDEO',
    });

    const usage = await prisma.aiUsage.findMany({
      where: { organizationId: starter.orgId, engine: 'video' },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ model: 'veo3_fast', unit: 'videos', inputAmount: 1 });
  } finally {
    await starter.remove();
  }
});

test('a trial makes its one clip, and the second is refused with 402', async () => {
  const trial = await throwawayOrg(prisma, {
    tier: 'PRO',
    totalChannels: 6,
    channels: 0,
    isTrailing: true,
  });
  try {
    expect(
      (await trial.api.get('/media/generate-video/veo3/allowed')).status()
    ).toBe(200);
    const first = await generate(trial.api, `Trial clip one ${Date.now()}`);
    expect(first.status(), await first.text()).toBe(201);
    const second = await generate(trial.api, `Trial clip two ${Date.now()}`);
    expect(second.status()).toBe(402);
    expect(await videosLeft(trial.api)).toBe(0);
  } finally {
    await trial.remove();
  }
});

test('a clip kie.ai fails: 422 with a reason, the credit is kept, nothing metered', async () => {
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    const res = await generate(pro.api, `stack-kie-fail ${Date.now()}`, 'horizontal');
    expect(res.status()).toBe(422);
    expect((await res.json()).message).toContain('could not make this video');
    expect(await videosLeft(pro.api)).toBe(30);
    expect(await prisma.media.count({ where: { organizationId: pro.orgId } })).toBe(0);
    expect(await prisma.aiUsage.count({ where: { organizationId: pro.orgId, engine: 'video' } })).toBe(0);
  } finally {
    await pro.remove();
  }
});

// A double click, or the assistant retrying, must not pay kie.ai twice for the
// same clip: while it is being made the same request is refused, and once it
// is done it comes back from the library.
test('the same clip asked for twice is made and paid for once', async () => {
  test.setTimeout(60_000);
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    const prompt = `stack-kie-slow A sunrise over Bristol harbour ${Date.now()}`;
    const first = generate(pro.api, prompt);
    // The first is in flight (its first poll says "generating").
    await expect.poll(async () => (await kieTasks(pro.api, prompt)).length).toBe(1);
    const during = await generate(pro.api, prompt);
    expect(during.status()).toBe(409);
    expect((await during.json()).message).toContain('already being made');

    const done = await first;
    expect(done.status(), await done.text()).toBe(201);
    const after = await generate(pro.api, prompt);
    expect(after.status()).toBe(201);
    expect((await after.json()).id).toBe((await done.json()).id);

    // A different shape is a different clip.
    const horizontal = await generate(pro.api, prompt, 'horizontal');
    expect(horizontal.status()).toBe(201);

    expect(await kieTasks(pro.api, prompt)).toHaveLength(2);
    expect(await videosLeft(pro.api)).toBe(28);
  } finally {
    await pro.remove();
  }
});

// Codex: a clip deleted from the library left its id behind, and asking for
// it again within the reuse window answered 409 "already being made".
test('a clip deleted from the library can be made again', async () => {
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    const prompt = `A kite over the Downs ${Date.now()}`;
    const first = await generate(pro.api, prompt);
    expect(first.status(), await first.text()).toBe(201);
    const { id } = await first.json();
    expect((await pro.api.delete(`/media/${id}`)).status()).toBeLessThan(300);

    const again = await generate(pro.api, prompt);
    expect(again.status(), await again.text()).toBe(201);
    expect((await again.json()).id).not.toBe(id);
    expect(await kieTasks(pro.api, prompt)).toHaveLength(2);
  } finally {
    await pro.remove();
  }
});
