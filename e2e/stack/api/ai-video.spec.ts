import { APIRequestContext, expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'crypto';
import Redis from 'ioredis';
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
    // The second joins the clip being made instead of paying for another.
    const during = await generate(pro.api, prompt);
    expect(during.status(), await during.text()).toBe(201);

    const done = await first;
    expect(done.status(), await done.text()).toBe(201);
    expect((await during.json()).id).toBe((await done.json()).id);
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

// A clip deleted from the library left its id behind, and asking for it again
// within the reuse window answered 409 "already being made".
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

// Past the load balancer's three minutes the browser loses the request while
// the clip is still being made. Asking where it stands must never make a clip
// or spend a credit: "pending" while it is made, the clip once it is, and
// "none" after a failure (a retried POST would have paid kie.ai again).
test('asking for a clip’s result never makes one', async () => {
  test.setTimeout(60_000);
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  const result = (prompt: string, output = 'vertical') =>
    pro.api.post('/media/generate-video/result', {
      data: { type: 'veo3', output, customParams: { prompt, images: [] } },
    });
  let first: Promise<unknown> | undefined;
  try {
    const slow = `stack-kie-slow A tram in Manchester ${Date.now()}`;
    first = generate(pro.api, slow);
    await expect.poll(async () => (await kieTasks(pro.api, slow)).length).toBe(1);
    const during = await result(slow);
    expect(during.status(), await during.text()).toBe(200);
    expect((await during.json()).status).toBe('pending');

    const done = (await first) as Awaited<ReturnType<typeof generate>>;
    expect(done.status(), await done.text()).toBe(201);
    const after = await (await result(slow)).json();
    expect(after.status).toBe('done');
    expect(after.media.id).toBe((await done.json()).id);

    const failed = `stack-kie-fail A ferry at Dover ${Date.now()}`;
    expect((await generate(pro.api, failed)).status()).toBe(422);
    const failure = await (await result(failed)).json();
    expect(failure.status).toBe('failed');
    expect(failure.message).toContain('could not make this video');
    expect((await (await result(`never asked ${Date.now()}`)).json()).status).toBe('none');

    expect(await kieTasks(pro.api, slow)).toHaveLength(1);
    expect(await kieTasks(pro.api, failed)).toHaveLength(1);
    expect(await videosLeft(pro.api)).toBe(29);
  } finally {
    // A failed assertion must not dispose the request still waiting on kie.ai.
    await first?.catch(() => undefined);
    await pro.remove();
  }
});

// A clip takes minutes: longer than
// the load balancer's three, the assistant's two-minute run and any API
// client's patience. Starting one answers at once; the server makes it,
// keeps it in the library and tells the organisation.
const start = (api: APIRequestContext, prompt: string, output = 'vertical') =>
  api.post('/media/generate-video/start', {
    data: { type: 'veo3', output, customParams: { prompt, images: [] } },
  });
const resultOf = (api: APIRequestContext, prompt: string, output = 'vertical') =>
  api.post('/media/generate-video/result', {
    data: { type: 'veo3', output, customParams: { prompt, images: [] } },
  });
const settled = async (api: APIRequestContext, prompt: string) => {
  let answer: any;
  await expect
    .poll(
      async () => {
        answer = await (await resultOf(api, prompt)).json();
        return answer.status;
      },
      { timeout: 45_000, intervals: [1_000] }
    )
    .not.toBe('pending');
  return answer;
};
const notifications = (orgId: string) =>
  prisma.notifications.findMany({ where: { organizationId: orgId }, select: { content: true } });

test('starting a clip answers at once; the server saves it to the library and announces it', async () => {
  test.setTimeout(60_000);
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    const prompt = `stack-kie-slow A narrowboat in Birmingham ${Date.now()}`;
    const asked = Date.now();
    const res = await start(pro.api, prompt);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(body.id).toMatch(/^[0-9a-f]{64}$/);
    // The fake kie.ai keeps a slow clip "generating" for one 10 s poll.
    expect(Date.now() - asked).toBeLessThan(5_000);
    // The credit is taken when the clip is started, once.
    expect(await videosLeft(pro.api)).toBe(29);
    expect((await (await resultOf(pro.api, prompt)).json()).status).toBe('pending');

    // Asked again while it is made: the same clip, not a second one.
    const again = await start(pro.api, prompt);
    expect((await again.json()).status).toBe('pending');

    const done = await settled(pro.api, prompt);
    expect(done.status).toBe('done');
    const media = await prisma.media.findUniqueOrThrow({ where: { id: done.media.id } });
    expect(media.organizationId).toBe(pro.orgId);
    expect(media.aiGenerated).toBe(true);
    expect(await kieTasks(pro.api, prompt)).toHaveLength(1);
    expect(await videosLeft(pro.api)).toBe(29);
    expect(
      await prisma.aiUsage.count({ where: { organizationId: pro.orgId, engine: 'video' } })
    ).toBe(1);
    expect((await notifications(pro.orgId)).map((n) => n.content)).toContain(
      'Your AI video is ready. You will find it in your media library.'
    );

    // Started again after it is made: answered from the library.
    const reused = await (await start(pro.api, prompt)).json();
    expect(reused.status).toBe('done');
    expect(reused.media.id).toBe(done.media.id);
  } finally {
    await pro.remove();
  }
});

test('a clip that fails after it started: the reason, the credit back, a notification', async () => {
  test.setTimeout(60_000);
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    const prompt = `stack-kie-fail A pier in Brighton ${Date.now()}`;
    const res = await start(pro.api, prompt);
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).status).toBe('pending');

    const failed = await settled(pro.api, prompt);
    expect(failed.status).toBe('failed');
    expect(failed.message).toContain('could not make this video');
    await expect.poll(() => videosLeft(pro.api)).toBe(30);
    expect(await prisma.media.count({ where: { organizationId: pro.orgId } })).toBe(0);
    expect(
      (await notifications(pro.orgId)).some((n) => n.content.includes('could not make this video'))
    ).toBe(true);

    // A failed clip does not block trying again.
    const retry = await start(pro.api, prompt);
    expect((await retry.json()).status).toBe('pending');
    expect(await kieTasks(pro.api, prompt)).toHaveLength(2);
    await settled(pro.api, prompt);
  } finally {
    await pro.remove();
  }
});

test('starting a clip with no credits left is refused at once with 402', async () => {
  const trial = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0, isTrailing: true });
  try {
    const first = await start(trial.api, `Trial start one ${Date.now()}`);
    expect((await first.json()).status).toBe('pending');
    const second = await start(trial.api, `Trial start two ${Date.now()}`);
    expect(second.status()).toBe(402);
  } finally {
    await trial.remove();
  }
});

test('public API: start answers with an id, the id answers where the clip stands, for its owner only', async () => {
  test.setTimeout(60_000);
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  const other = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    const key = async (orgId: string) =>
      (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).apiKey!;
    const headers = { Authorization: await key(pro.orgId) };
    const res = await pro.api.post('/public/v1/generate-video/start', {
      headers,
      data: { type: 'veo3', output: 'horizontal', customParams: { prompt: `stack-kie-slow A bus in Leeds ${Date.now()}`, images: [] } },
    });
    expect(res.status(), await res.text()).toBe(200);
    const { status, id } = await res.json();
    expect(status).toBe('pending');

    const where = (h: Record<string, string>) => pro.api.get(`/public/v1/generate-video/${id}`, { headers: h });
    expect((await (await where(headers)).json()).status).toBe('pending');
    await expect
      .poll(async () => (await (await where(headers)).json()).status, { timeout: 45_000, intervals: [1_000] })
      .toBe('done');
    const done = await (await where(headers)).json();
    expect(done.media.path).toMatch(/\.mp4$/);

    // Another organisation gets 404, as for an id that does not exist, and
    // does not make the owner's finished clip forgotten.
    const foreign = await where({ Authorization: await key(other.orgId) });
    expect(foreign.status()).toBe(404);
    expect((await (await where(headers)).json()).status).toBe('done');
    expect((await pro.api.get('/public/v1/generate-video/not-an-id', { headers })).status()).toBe(404);
    expect(
      (await pro.api.get(`/public/v1/generate-video/${'0'.repeat(64)}`, { headers })).status()
    ).toBe(404);

    // How another organisation's clip failed is not theirs to read either.
    const failing = await pro.api.post('/public/v1/generate-video/start', {
      headers,
      data: { type: 'veo3', output: 'vertical', customParams: { prompt: `stack-kie-fail A tram in Sheffield ${Date.now()}`, images: [] } },
    });
    const failedId = (await failing.json()).id;
    const failedAt = (h: Record<string, string>) => pro.api.get(`/public/v1/generate-video/${failedId}`, { headers: h });
    await expect
      .poll(async () => (await (await failedAt(headers)).json()).status, { timeout: 30_000, intervals: [1_000] })
      .toBe('failed');
    expect((await failedAt({ Authorization: await key(other.orgId) })).status()).toBe(404);
  } finally {
    await pro.remove();
    await other.remove();
  }
});

// The hour after signup held only on the Studio and composer buttons: a
// trial that signed up minutes ago got its clip through the public API (and
// the assistant and MCP, which spend through the same place).
test('a trial that signed up minutes ago waits the hour through the public API too', async () => {
  const fresh = await throwawayOrg(prisma, {
    tier: 'PRO',
    totalChannels: 6,
    channels: 0,
    isTrailing: true,
    createdAt: new Date(Date.now() - 10 * 60_000),
  });
  try {
    const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: fresh.orgId } });
    const marker = `Fresh trial clip ${Date.now()}`;
    const res = await fresh.api.post('/public/v1/generate-video/start', {
      headers: { Authorization: apiKey! },
      data: { type: 'veo3', output: 'vertical', customParams: { prompt: marker, images: [] } },
    });
    expect(res.status(), await res.text()).toBe(403);
    expect((await res.json()).message).toMatch(/^AI tools unlock one hour after signup, in 5\d minutes\./);
    expect(await videosLeft(fresh.api)).toBe(1);
    expect(await kieTasks(fresh.api, marker)).toHaveLength(0);
    // Asked again, the same request is not "already being made".
    const again = await fresh.api.post('/public/v1/generate-video/start', {
      headers: { Authorization: apiKey! },
      data: { type: 'veo3', output: 'vertical', customParams: { prompt: marker, images: [] } },
    });
    expect(again.status()).toBe(403);
  } finally {
    await fresh.remove();
  }
});

// The limits the API docs promise: 5 starts and 120 lookups per 5 minutes
// per key, and another key keeps its own.
test('public API: 5 video starts and 120 lookups per 5 minutes per key', async () => {
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  const other = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    const key = async (orgId: string) =>
      (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).apiKey!;
    const headers = { Authorization: await key(pro.orgId) };
    // An engine that does not exist: refused by validation (400), no clip,
    // still counted.
    const startOnce = (h: Record<string, string>) =>
      pro.api.post('/public/v1/generate-video/start', {
        headers: h,
        data: { type: 'no-such-engine', output: 'vertical', customParams: { prompt: 'x', images: [] } },
      });
    for (let i = 0; i < 5; i++) {
      expect((await startOnce(headers)).status()).toBe(400);
    }
    expect((await startOnce(headers)).status()).toBe(429);
    expect((await startOnce({ Authorization: await key(other.orgId) })).status()).toBe(400);

    const lookups = await Promise.all(
      Array.from({ length: 120 }, () => pro.api.get(`/public/v1/generate-video/${'0'.repeat(64)}`, { headers }))
    );
    expect(lookups.map((r) => r.status()).filter((s) => s !== 404)).toEqual([]);
    expect((await pro.api.get(`/public/v1/generate-video/${'0'.repeat(64)}`, { headers })).status()).toBe(429);
  } finally {
    await pro.remove();
    await other.remove();
  }
});

// A deploy or a restart stops the process making a clip. Its job stays in
// Redis with the kie.ai task id, and another process finishes it within a
// minute: the customer paid one credit and gets the clip. A job stopped
// before kie.ai had it fails and hands the credit back.
test('a clip whose process stopped is finished by another, or failed with the credit back', async () => {
  test.setTimeout(150_000);
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:56379');
  try {
    const body = (prompt: string) => ({ type: 'veo3', output: 'vertical', customParams: { prompt, images: [] } });
    const keyOf = (b: ReturnType<typeof body>) =>
      createHash('sha256').update(JSON.stringify([pro.orgId, b.type, b.output, b.customParams])).digest('hex');
    const leave = async (b: ReturnType<typeof body>, taskId?: string) => {
      const credit = await prisma.credits.create({
        data: { organizationId: pro.orgId, credits: 1, type: 'ai_videos' },
      });
      const id = keyOf(b);
      await redis.set(`ai-video:${id}`, 'pending', 'EX', 900);
      await redis.set(
        `ai-video-job:${id}`,
        JSON.stringify({ orgId: pro.orgId, body: b, creditId: credit.id, startedAt: Date.now(), ...(taskId ? { taskId } : {}) }),
        'EX',
        1800
      );
    };

    // Started at kie.ai by a process that then stopped.
    const made = body(`A canal boat left behind ${randomBytes(4).toString('hex')}`);
    const task = await (
      await pro.api.post('http://localhost:58090/api/v1/jobs/createTask', {
        headers: { Authorization: 'Bearer stack-fake-kie' },
        data: { model: 'veo-3-1', input: { prompt: made.customParams.prompt } },
      })
    ).json();
    await leave(made, task.data.taskId);
    // Stopped before kie.ai had it.
    const lost = body(`A clip that never started ${randomBytes(4).toString('hex')}`);
    await leave(lost);
    // Saved to the library just before its process stopped: finished
    // without a second file.
    const saved = body(`A clip saved just in time ${randomBytes(4).toString('hex')}`);
    const existing = await prisma.media.create({
      data: { organizationId: pro.orgId, name: 'saved.mp4', path: 'http://localhost/saved.mp4', type: 'video', aiGenerated: true },
    });
    await leave(saved, 'stack-kie-gone');
    await redis.set(
      `ai-video-job:${keyOf(saved)}`,
      JSON.stringify({ ...JSON.parse((await redis.get(`ai-video-job:${keyOf(saved)}`))!), mediaId: existing.id }),
      'EX',
      1800
    );
    expect(await videosLeft(pro.api)).toBe(27);

    const statusOf = async (b: ReturnType<typeof body>) =>
      (await (await pro.api.post('/media/generate-video/result', { data: b })).json()).status;
    await expect.poll(() => statusOf(made), { timeout: 100_000, intervals: [2_000] }).toBe('done');
    await expect.poll(() => statusOf(lost), { timeout: 30_000, intervals: [2_000] }).toBe('failed');
    await expect.poll(() => statusOf(saved), { timeout: 30_000, intervals: [2_000] }).toBe('done');
    const savedResult = await (await pro.api.post('/media/generate-video/result', { data: saved })).json();
    expect(savedResult.media.id).toBe(existing.id);
    expect(await prisma.media.count({ where: { organizationId: pro.orgId, aiGenerated: true } })).toBe(2);
    // One credit each for the clips made, none for the one lost; kie.ai
    // asked once.
    expect(await videosLeft(pro.api)).toBe(28);
    expect(await kieTasks(pro.api, made.customParams.prompt)).toHaveLength(1);
    expect(await redis.exists(`ai-video-job:${keyOf(made)}`, `ai-video-job:${keyOf(lost)}`)).toBe(0);
  } finally {
    redis.disconnect();
    await pro.remove();
  }
});
