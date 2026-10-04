import { expect, request, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// Cost routes carry their own @Throttle (Plan/lunchdayfinal.md §11.3 #12).
// Buckets are per organisation and per route: one org hitting a limit must not
// slow down another, and a public API key is limited as its organisation.

const prisma = database();
const orgs: { remove: () => Promise<void> }[] = [];
const org = async () => {
  const created = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  orgs.push(created);
  return created;
};
test.afterAll(async () => {
  for (const created of orgs) await created.remove();
  await prisma.$disconnect();
});

// A loopback URL fails validation after the guard, so the attempt counts
// toward the limit without sending anything anywhere.
const testWebhook = (api: Awaited<ReturnType<typeof org>>['api']) =>
  api.post('/webhooks/send?url=http%3A%2F%2F127.0.0.1%2F', { data: {} });

test('webhook test sends: the 11th in five minutes is 429, another org is unaffected', async () => {
  const first = await org();
  const second = await org();

  for (let i = 0; i < 10; i++) {
    expect((await testWebhook(first.api)).status()).not.toBe(429);
  }
  const limited = await testWebhook(first.api);
  expect(limited.status()).toBe(429);
  expect(await limited.text()).toMatch(/too many requests/i);

  expect((await testWebhook(second.api)).status()).not.toBe(429);
});

test('the public API is limited per key: the 31st missing-content call is 429, another key is not', async () => {
  const first = await org();
  const second = await org();
  const keyOf = async (id: string) =>
    (await prisma.organization.findUniqueOrThrow({ where: { id } })).apiKey!;
  const client = async (key: string) =>
    request.newContext({ baseURL: `${BACKEND_URL}/public/v1/`, extraHTTPHeaders: { authorization: key } });
  const a = await client(await keyOf(first.orgId));
  const b = await client(await keyOf(second.orgId));
  const missing = (api: typeof a) => api.get('posts/00000000-0000-4000-8000-000000000000/missing');

  for (let i = 0; i < 30; i++) {
    expect((await missing(a)).status()).not.toBe(429);
  }
  expect((await missing(a)).status()).toBe(429);
  expect((await missing(b)).status()).not.toBe(429);
  await a.dispose();
  await b.dispose();
});

// Every page load of the app asks the AI runtime which agents exist
// (CopilotKit's `availableAgents`) on POST /copilot/chat. Counted toward the
// 30-per-5-minutes AI limit, a team clicking around used up its organisation's
// AI allowance in minutes, and every later page load and suggestion got 429.
// The metadata query costs nothing; anything else on the route still counts.
const AVAILABLE_AGENTS = {
  operationName: 'availableAgents',
  query: 'query availableAgents {\n  availableAgents {\n    agents {\n      name\n      id\n      description\n    }\n  }\n}',
  variables: {},
};

test('page loads asking which AI agents exist do not use up the AI limit', async () => {
  test.setTimeout(60_000);
  const first = await org();
  for (let i = 0; i < 35; i++) {
    const res = await first.api.post('/copilot/chat', { data: AVAILABLE_AGENTS });
    expect(res.status(), `metadata query ${i + 1}`).not.toBe(429);
  }
});

test('a mutation named like the metadata query is still limited', async () => {
  test.setTimeout(60_000);
  const first = await org();
  const disguised = {
    operationName: 'availableAgents',
    query: 'mutation availableAgents { generateCopilotResponse(data: {}) { threadId } }',
    variables: {},
  };
  const statuses: number[] = [];
  for (let i = 0; i < 31; i++) {
    statuses.push((await first.api.post('/copilot/chat', { data: disguised })).status());
  }
  expect(statuses.slice(0, 30)).not.toContain(429);
  expect(statuses[30]).toBe(429);
});
