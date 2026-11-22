import { APIRequestContext, expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { anonymous, signedIn, throwawayOrg } from '../helpers';
import { USERS } from '../seed';

// The composer's AI on the real app code, with fake-openai.mjs standing in for
// OpenAI (stack.env: OPENAI_BASE_URL). What a mock can prove: requests are
// built and answers parsed, usage is metered, and the guards hold. What it
// cannot — a broken key or SDK on production — is the nightly canary's job.

const FAKE = 'http://localhost:58090';
const ANSWER = 'Stack AI answer.';
const TEXT =
  'Postra lets small agencies plan, write and publish social posts for every client from one calendar.';

let owner: APIRequestContext;
let prisma: PrismaClient;
test.beforeAll(async () => {
  owner = await signedIn('a');
  prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
});
test.afterAll(async () => {
  await owner.dispose();
  await prisma.$disconnect();
});

// AI calls and the usage table are shared state.
test.describe.configure({ mode: 'serial' });

const usageRows = async () => {
  const org = await prisma.organization.findFirstOrThrow({ where: { name: USERS.a.org } });
  return prisma.aiUsage.findMany({ where: { organizationId: org.id } });
};

test('"Shorten" in the composer returns the model\'s text and is metered', async () => {
  const before = (await usageRows()).length;

  const res = await owner.post('/media/ai-edit', {
    data: { text: TEXT, action: 'shorten', platform: 'bluesky' },
  });
  expect(res.status(), await res.text()).toBe(201);
  expect(await res.json()).toMatchObject({ text: ANSWER });

  await expect.poll(async () => (await usageRows()).length).toBeGreaterThan(before);
  const latest = (await usageRows()).sort((x, y) => +y.createdAt - +x.createdAt)[0];
  expect(latest).toMatchObject({ inputAmount: 11, outputAmount: 7 });
});

test('hashtag suggestions come back as a list', async () => {
  const res = await owner.post('/media/suggest-hashtags', {
    data: { text: TEXT, platform: 'instagram' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body: { hashtags: string[] } = await res.json();
  expect(body.hashtags.length).toBeGreaterThan(0);
});

test('the post Creator (LangChain graph) streams a result and is metered', async () => {
  test.setTimeout(90_000);
  const org = await prisma.organization.findFirstOrThrow({ where: { name: USERS.a.org } });
  const before = await prisma.aiUsage.count({
    where: { organizationId: org.id, engine: 'generate-posts' },
  });

  const res = await owner.post('/posts/generator', {
    data: { research: 'Five tips for planning a month of social posts', isPicture: false, format: 'one_short', tone: 'company' },
    timeout: 80_000,
  });
  expect(res.status(), (await res.text()).slice(0, 500)).toBe(201);
  const text = await res.text();
  const lines = text.trim().split('\n').map((line) => JSON.parse(line));
  // The whole graph ran, not just its first step, and the browser is sent
  // step names and the posts, not the graph's state on every event.
  const steps = lines.map((l) => l.name);
  for (const step of ['find-category', 'generate-hook', 'generate-content', 'post-time', 'done']) {
    expect(steps, step).toContain(step);
  }
  expect(steps).not.toContain('error');
  expect(text.length).toBeLessThan(5_000);
  const { hook, content, date } = lines.at(-1).data.output;
  expect(hook).toBeTruthy();
  expect(content[0].content).toBeTruthy();
  expect(date).toBeTruthy();

  const after = await prisma.aiUsage.count({
    where: { organizationId: org.id, engine: 'generate-posts' },
  });
  expect(after, 'Creator LLM calls recorded in AiUsage').toBeGreaterThan(before);
});

test('the composer chat answers with a reply and a draft, and is metered as the composer', async () => {
  const org = await prisma.organization.findFirstOrThrow({ where: { name: USERS.a.org } });
  const count = () => prisma.aiUsage.count({ where: { organizationId: org.id, engine: 'composer' } });
  const before = await count();
  const marker = `stack-composer-chat-${Date.now()}`;

  const res = await owner.post('/media/ai-chat', {
    data: {
      messages: [{ role: 'user', content: `Write a post about our new menu ${marker}` }],
      posts: [`Our summer menu is here draft-${marker}`],
      platform: 'bluesky',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  // One post is never a thread, whatever the model ticked.
  expect(await res.json()).toEqual({ reply: ANSWER, posts: [ANSWER], thread: false });
  await expect.poll(count).toBeGreaterThan(before);

  // The model was given what the composer holds, not only the question.
  const seen = (await (await owner.get(`${FAKE}/__seen?text=${encodeURIComponent(`draft-${marker}`)}`)).json()) as { count: number };
  expect(seen.count).toBe(1);
});

test('a malformed chat never reaches OpenAI', async () => {
  const marker = `stack-bad-chat-${Date.now()}`;
  const say = (content: string, role = 'user') => ({ role, content });
  for (const data of [
    {},
    { messages: [] },
    { messages: [say(marker, 'system')] },
    { messages: [say(marker), say(`sure ${marker}`, 'assistant')] },
    { messages: Array.from({ length: 21 }, () => say(marker)) },
    { messages: [say(`${marker} ${'x'.repeat(6001)}`)] },
    { messages: [say(marker)], posts: Array.from({ length: 11 }, () => 'post') },
    { messages: [say(marker)], posts: [`${'x'.repeat(5001)}`] },
  ]) {
    const res = await owner.post('/media/ai-chat', { data });
    expect(res.status(), JSON.stringify(data).slice(0, 120)).toBe(400);
  }
  const seen = (await (await owner.get(`${FAKE}/__seen?text=${encodeURIComponent(marker)}`)).json()) as { count: number };
  expect(seen.count).toBe(0);
});

test('the composer chat is behind the same gates as the ribbon', async () => {
  const data = { messages: [{ role: 'user', content: 'Write a post' }] };
  const nobody = await anonymous();
  expect((await nobody.post('/media/ai-chat', { data })).status()).toBe(401);
  await nobody.dispose();

  const trial = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0, isTrailing: true });
  try {
    await prisma.user.update({ where: { id: trial.userId }, data: { createdAt: new Date() } });
    const res = await trial.api.post('/media/ai-chat', { data });
    expect(res.status()).toBe(403);
    expect((await res.json()).message).toMatch(/^AI tools unlock one hour after signup/);
  } finally {
    await trial.remove();
  }
});

test('a bad request never reaches OpenAI', async () => {
  // Counted by this test's own text: the fake's global request count moved
  // whenever another AI spec ran in parallel in CI.
  const marker = `stack-bad-request-${Date.now()}`;
  const seen = async (text: string) =>
    ((await (await owner.get(`${FAKE}/__seen?text=${encodeURIComponent(text)}`)).json()) as { count: number }).count;
  const short = '⁂¶'; // too short to edit, and in no other spec's text
  for (const data of [
    { text: short, action: 'shorten' },
    { text: `${TEXT} ${marker}`, action: 'write-my-thesis' },
    { text: `${TEXT} ${marker}`, action: 'translate', language: 'klingon' },
  ]) {
    expect((await owner.post('/media/ai-edit', { data })).status(), JSON.stringify(data)).toBe(400);
  }
  expect(await seen(marker)).toBe(0);
  expect(await seen(short)).toBe(0);
});

test('a brand-new account on a trial waits an hour for AI', async () => {
  // Nobody has paid for a trial yet: the hour is what stops a fresh signup
  // spending AI straight away.
  const trial = await throwawayOrg(prisma, {
    tier: 'PRO',
    totalChannels: 6,
    channels: 0,
    isTrailing: true,
  });
  try {
    await prisma.user.update({ where: { id: trial.userId }, data: { createdAt: new Date() } });
    const res = await trial.api.post('/media/ai-edit', {
      data: { text: TEXT, action: 'shorten' },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).message).toMatch(
      /^AI tools unlock one hour after signup, in \d+ minutes?\. /
    );
  } finally {
    await trial.remove();
  }
});

test('a brand-new member of a paying organisation does not wait', async () => {
  // The organisation has paid; the hour only held up its new people.
  const member = await signedIn('member');
  const res = await member.post('/media/ai-edit', {
    data: { text: TEXT, action: 'shorten' },
  });
  expect(res.status(), await res.text()).toBe(201);
  await member.dispose();
});
