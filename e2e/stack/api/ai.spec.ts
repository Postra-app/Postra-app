import { APIRequestContext, expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { signedIn } from '../helpers';
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
  const events = (await res.text()).trim().split('\n').map((line) => JSON.parse(line));
  // The whole graph ran, not just its first step.
  const nodes = new Set(events.map((e) => e.metadata?.langgraph_node));
  for (const node of ['find-category', 'generate-hook', 'generate-content', 'post-time']) {
    expect(nodes.has(node), node).toBe(true);
  }
  expect(JSON.stringify(events)).not.toMatch(/"error"|Error:/);

  const after = await prisma.aiUsage.count({
    where: { organizationId: org.id, engine: 'generate-posts' },
  });
  expect(after, 'Creator LLM calls recorded in AiUsage').toBeGreaterThan(before);
});

test('a bad request never reaches OpenAI', async () => {
  // Counted by this test's own text: the fake's global request count moved
  // whenever another AI spec ran in parallel (CI, 10-04).
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

test('a brand-new account waits an hour for AI', async () => {
  const member = await signedIn('member');
  const res = await member.post('/media/ai-edit', {
    data: { text: TEXT, action: 'shorten' },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).message).toMatch(/minutes after signup/);
  await member.dispose();
});
