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
