import { spawn, execSync } from 'node:child_process';
import { openSync } from 'node:fs';
import { APIRequestContext, expect, test } from '@playwright/test';
import { Connection, WorkflowClient } from '@temporalio/client';
import { listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';

// U13 — a restart must not delay a post by long nor publish it twice
// (Plan/upstream_sync.md §0, e2e/bugs.md E2E-11-01). The orchestrator is killed
// with SIGKILL, like a deploy or a watchdog restart would, and started again.
// Slow (~8 min), so not part of the pull-request run: `pnpm e2e:stack:restart`.

const FAKE = 'http://localhost:58080';
const CHANNEL = USERS.a.mastodon.id;
const repo = `${__dirname}/../../..`;

let api: APIRequestContext;
let temporal: WorkflowClient;
test.beforeAll(async () => {
  api = await signedIn('a');
  temporal = new WorkflowClient({
    connection: await Connection.connect({ address: 'localhost:57233' }),
  });
});
test.afterAll(async () => {
  await startOrchestrator(); // leave the stack as we found it
  await api.dispose();
});

test.describe.configure({ mode: 'serial', timeout: 8 * 60_000 });

const orchestratorUp = async () =>
  fetch('http://localhost:9464/metrics').then((r) => r.ok, () => false);

const killOrchestrator = async () => {
  execSync('lsof -ti tcp:9464 -sTCP:LISTEN | xargs kill -9 || true');
  await expect.poll(orchestratorUp, { timeout: 15_000 }).toBe(false);
};

const startOrchestrator = async () => {
  if (await orchestratorUp()) return;
  const log = openSync(`${__dirname}/../.logs/orchestrator.log`, 'a');
  spawn('node', ['--experimental-require-module', './dist/apps/orchestrator/src/main.js'], {
    cwd: `${repo}/apps/orchestrator`,
    env: process.env,
    detached: true,
    stdio: ['ignore', log, log],
  }).unref();
  await expect.poll(orchestratorUp, { timeout: 120_000, intervals: [1_000] }).toBe(true);
};

const received = async (content: string) =>
  ((await (await api.get(`${FAKE}/__received`)).json()) as { status: string }[]).filter(
    (r) => r.status === content
  ).length;

const publishNow = async (content: string) => {
  const res = await api.post('/posts', {
    data: {
      type: 'now',
      shortLink: false,
      date: new Date().toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: CHANNEL },
          value: [{ content, image: [] }],
          settings: { __type: 'mastodon' },
        },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await listPosts(api)).find((p) => p.content.includes(content))!;
};

const stored = async (id: string) =>
  (await (await api.get(`/posts/${id}`)).json()).posts[0] as {
    state: string;
    error: string | null;
  };

// What the publishing activity last told Temporal it was doing.
const pendingHeartbeat = async (postId: string) => {
  const d = await temporal.getHandle(`post_${postId}`).describe();
  const payload = d.raw.pendingActivities?.[0]?.heartbeatDetails?.payloads?.[0]?.data;
  return payload ? JSON.parse(Buffer.from(payload).toString()) : null;
};

test('runs post workflow v1.0.9', async () => {
  const content = `[stack] v1.0.9 ${Date.now()}`;
  const post = await publishNow(content);
  await expect.poll(async () => (await stored(post.id)).state, { timeout: 90_000 }).toBe('PUBLISHED');
  expect((await temporal.getHandle(`post_${post.id}`).describe()).type).toBe('postWorkflowV109');
});

test('worker down when the post is due: it goes out once the worker is back', async () => {
  await killOrchestrator();
  const content = `[stack] worker down ${Date.now()}`;
  const post = await publishNow(content);

  await new Promise((r) => setTimeout(r, 15_000));
  expect((await stored(post.id)).state).toBe('QUEUE');
  expect(await received(content)).toBe(0);

  await startOrchestrator();
  await expect.poll(async () => (await stored(post.id)).state, { timeout: 120_000 }).toBe('PUBLISHED');
  expect(await received(content)).toBe(1);
});

test('a slow platform answer: the activity heartbeats through it and publishes once', async () => {
  await api.post(`${FAKE}/__hold`, { data: { ms: 100_000 } });
  const content = `[stack] slow answer ${Date.now()}`;
  const post = await publishNow(content);

  await expect.poll(() => pendingHeartbeat(post.id), { timeout: 60_000 }).toBe('publish: mastodon');
  await expect
    .poll(async () => (await stored(post.id)).state, { timeout: 4 * 60_000, intervals: [5_000] })
    .toBe('PUBLISHED');
  expect(await received(content)).toBe(1);
});

test('worker killed after the platform got the post: no second post, the user is told to check', async () => {
  await api.post(`${FAKE}/__hold`, { data: { ms: 60_000 } });
  const content = `[stack] killed mid-publish ${Date.now()}`;
  const post = await publishNow(content);

  await expect.poll(() => received(content), { timeout: 60_000 }).toBe(1);
  await expect.poll(() => pendingHeartbeat(post.id), { timeout: 10_000 }).toBe('publish: mastodon');
  const killedAt = Date.now();
  await killOrchestrator();
  await startOrchestrator();

  await expect
    .poll(async () => (await stored(post.id)).state, { timeout: 5 * 60_000, intervals: [5_000] })
    .toBe('ERROR');
  const minutes = (Date.now() - killedAt) / 60_000;
  test.info().annotations.push({ type: 'kill → ERROR', description: `${minutes.toFixed(1)} min` });
  expect(minutes).toBeLessThan(4.5); // heartbeatTimeout 3 min, not startToClose 30 min

  await new Promise((r) => setTimeout(r, 30_000));
  expect(await received(content), 'published once, never retried').toBe(1);
  expect((await stored(post.id)).error).toMatch(/[Hh]eartbeat/);
});
