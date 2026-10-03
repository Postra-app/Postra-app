import { APIRequestContext, expect, test } from '@playwright/test';
import { Connection, Client } from '@temporalio/client';
import { listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';

// What Temporal keeps running for a post, read from Temporal itself.
// A post on N channels is N posts with N workflows; Repeat keeps the workflow
// alive after publishing, waiting for the next run.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

let api: APIRequestContext;
let temporal: Client;
let connection: Connection;
test.beforeAll(async () => {
  api = await signedIn('a');
  connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS || 'localhost:57233' });
  temporal = new Client({ connection, namespace: 'default' });
});
test.afterAll(async () => {
  await api.dispose();
  await connection.close();
});

const running = async (postId: string) => {
  const ids: string[] = [];
  for await (const w of temporal.workflow.list({ query: `postId="${postId}" AND ExecutionStatus="Running"` })) {
    ids.push(w.workflowId);
  }
  return ids;
};

const post = (content: string, type: 'now' | 'schedule', date: Date, extra: Record<string, unknown> = {}) => ({
  type,
  shortLink: false,
  date: date.toISOString(),
  tags: [],
  ...extra,
  posts: [
    { integration: { id: USERS.a.mastodon.id }, value: [{ content, image: [] }], settings: { __type: 'mastodon' } },
    { integration: { id: USERS.a.channel.id }, value: [{ content, image: [] }], settings: { __type: 'bluesky' } },
  ],
});

// The composer sends one group for every channel, but the server gives each
// channel's post its own group: a calendar tile is one channel, and deleting
// it stops that channel's workflow only.
test('a post on two channels is two posts; deleting one leaves the other scheduled', async () => {
  const content = `[stack] two channels ${Date.now()}`;
  const res = await api.post('/posts', { data: post(content, 'schedule', new Date(Date.now() + 86_400_000)) });
  expect(res.status(), await res.text()).toBe(201);
  const posts = (await listPosts(api)).filter((p) => p.content === content);
  expect(posts).toHaveLength(2);
  expect(new Set(posts.map((p) => p.group)).size, 'a group per channel').toBe(2);
  await expect.poll(async () => (await Promise.all(posts.map((p) => running(p.id)))).map((r) => r.length), { timeout: 30_000 }).toEqual([1, 1]);

  expect((await (await api.delete(`/posts/${posts[0].group}`)).json()).deleted).toBe(true);
  await expect.poll(() => running(posts[0].id), { timeout: 15_000 }).toEqual([]);
  expect(await running(posts[1].id), 'the other channel still scheduled').toHaveLength(1);

  await api.delete(`/posts/${posts[1].group}`);
  await expect.poll(() => running(posts[1].id), { timeout: 15_000 }).toEqual([]);
});

test('Repeat keeps the workflow waiting after publishing, and Delete stops it', async () => {
  const content = `[stack] repeat daily ${Date.now()}`;
  const res = await api.post('/posts', {
    data: { ...post(content, 'now', new Date(), { inter: 1 }), posts: [post(content, 'now', new Date()).posts[0]] },
  });
  expect(res.status(), await res.text()).toBe(201);
  const [created] = (await listPosts(api)).filter((p) => p.content === content);
  const stored = async () => (await (await api.get(`/posts/${created.id}`)).json()).posts[0];

  await expect.poll(async () => (await stored()).state, { timeout: 90_000, intervals: [1_000, 2_000] }).toBe('PUBLISHED');
  expect((await stored()).intervalInDays).toBe(1);
  // Published, and still running: asleep until tomorrow's repeat.
  expect(await running(created.id)).toHaveLength(1);

  expect((await (await api.delete(`/posts/${created.group}`)).json()).deleted).toBe(true);
  await expect.poll(() => running(created.id), { timeout: 15_000 }).toEqual([]);
});

// The daily housekeeping (E2E-06-01): started by the backend when RUN_CRON is
// set; here started by hand. Its first run removes the file behind a media row
// deleted longer ago than the grace period, and the row.
test('housekeeping removes a file deleted past its grace period', async () => {
  const { writeFileSync, existsSync, mkdirSync } = await import('fs');
  const { database } = await import('../helpers');
  const dir = process.env.UPLOAD_DIRECTORY || '/tmp/postra-e2e-stack-uploads';
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/housekeeping-${Date.now()}.png`;
  writeFileSync(file, 'x');
  const prisma = database();
  const org = await prisma.organization.findFirstOrThrow({ where: { name: USERS.a.org } });
  const row = await prisma.media.create({
    data: { name: 'old.png', path: file, organizationId: org.id, deletedAt: new Date(Date.now() - 40 * 86_400_000) },
  });
  const handle = await temporal.workflow.start('housekeepingWorkflow', {
    workflowId: `housekeeping-stack-${Date.now()}`,
    taskQueue: 'main',
  });
  try {
    await expect.poll(() => existsSync(file), { timeout: 60_000 }).toBe(false);
    await expect.poll(async () => prisma.media.count({ where: { id: row.id } }), { timeout: 10_000 }).toBe(0);
  } finally {
    await handle.terminate();
    await prisma.media.deleteMany({ where: { id: row.id } });
    await prisma.$disconnect();
  }
});
