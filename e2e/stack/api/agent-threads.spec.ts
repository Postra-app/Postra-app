import { randomUUID } from 'node:crypto';
import { APIRequestContext, expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// CopilotKit's runtime keeps every chat's events in one store for the whole
// process, keyed by thread id alone. Organisation B holding a thread id of A
// must not be able to read that chat, continue it or stop it, nor reach the
// store through the runtime's thread resource methods.

// Throwaway organisations: the seeded ones run other agent specs in parallel,
// and an organisation runs at most two agent replies at once.
const prisma = database();
const orgs: Awaited<ReturnType<typeof throwawayOrg>>[] = [];
let a: APIRequestContext;
let b: APIRequestContext;
const threadId = randomUUID();

const call = (api: APIRequestContext, data: unknown) => api.post('/copilot/agent', { data });
const runBody = (text: string) => ({
  threadId,
  runId: randomUUID(),
  messages: [{ id: randomUUID(), role: 'user', content: text }],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
});

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    orgs.push(await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 }));
  }
  [a, b] = orgs.map((o) => o.api);
});
test.afterAll(async () => {
  for (const o of orgs) await o.remove();
  await prisma.$disconnect();
});

test("organisation A's chat runs and is A's", async () => {
  test.setTimeout(60_000);
  const res = await call(a, { method: 'agent/run', params: { agentId: 'postra' }, body: runBody('Hello from A') });
  expect(res.status(), await res.text()).toBe(200);
  await expect
    .poll(async () => ((await (await a.get(`/copilot/${threadId}/list`)).json()).messages ?? []).length)
    .toBeGreaterThan(0);
});

test("organisation B cannot connect to, continue or stop A's chat", async () => {
  for (const data of [
    { method: 'agent/connect', params: { agentId: 'postra' }, body: { ...runBody(''), messages: [] } },
    { method: 'agent/run', params: { agentId: 'postra' }, body: runBody('Hello from B') },
    { method: 'agent/stop', params: { agentId: 'postra', threadId } },
  ]) {
    const res = await call(b, data);
    expect(res.status(), data.method).toBe(404);
  }
  // A's own connect still answers.
  const own = await call(a, { method: 'agent/connect', params: { agentId: 'postra' }, body: { ...runBody(''), messages: [] } });
  expect(own.status()).toBe(200);
});

test('the runtime thread resource methods are not served', async () => {
  for (const method of ['resource/request', 'threads/state', 'threads/messages', 'threads/events', 'threads/list']) {
    const res = await call(b, { method, params: { threadId, agentId: 'postra' } });
    expect(res.status(), method).toBe(404);
  }
});
