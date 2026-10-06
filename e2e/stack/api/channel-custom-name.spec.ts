import { APIRequestContext, expect, test } from '@playwright/test';
import { database, signedIn } from '../helpers';
import { USERS } from '../seed';

// Upstream 5a1e92b4 + bb2e0176: a channel can carry its own name in Postra
// while the platform's name stays as it is. Admins only, like the other
// channel management routes. Another organisation: tenant-isolation.spec.ts.

const CHANNEL = USERS.a.channel.id;
// One channel shared by every test here, so one after another.
test.describe.configure({ mode: 'serial' });
let a: APIRequestContext, member: APIRequestContext;
test.beforeAll(async () => {
  [a, member] = await Promise.all([signedIn('a'), signedIn('member')]);
});
test.afterAll(async () => {
  await a.put(`/integrations/${CHANNEL}/custom-name`, { data: { name: '' } });
  await Promise.all([a.dispose(), member.dispose()]);
});

const listed = async (api: APIRequestContext) =>
  ((await (await api.get('/integrations/list')).json()).integrations as { id: string; name: string; originalName: string }[]).find(
    (c) => c.id === CHANNEL
  );

test('a renamed channel shows its Postra name and keeps the platform name', async () => {
  const before = await listed(a);
  const res = await a.put(`/integrations/${CHANNEL}/custom-name`, { data: { name: '  Client X — Bluesky  ' } });
  expect(res.status()).toBe(200);
  // Only the id: the row holds the channel's tokens.
  expect(await res.json()).toEqual({ id: CHANNEL });

  const after = await listed(a);
  expect(after?.name).toBe('Client X — Bluesky');
  expect(after?.originalName).toBe(before?.originalName);

  const pub = await a.get('/public/v1/integrations', { headers: { Authorization: USERS.a.apiKey } });
  expect(pub.status()).toBe(200);
  expect((await pub.json()).find((c: { id: string }) => c.id === CHANNEL)?.name).toBe('Client X — Bluesky');

  const prisma = database();
  const row = await prisma.integration.findUnique({ where: { id: CHANNEL }, select: { name: true, customName: true } });
  await prisma.$disconnect();
  expect(row).toEqual({ name: before?.originalName, customName: 'Client X — Bluesky' });

  expect((await a.put(`/integrations/${CHANNEL}/custom-name`, { data: { name: '' } })).status()).toBe(200);
  expect((await listed(a))?.name).toBe(before?.originalName);
});

test('a plain member cannot rename', async () => {
  expect((await member.put(`/integrations/${CHANNEL}/custom-name`, { data: { name: 'member name' } })).status()).toBe(403);
});

test('a name over 100 characters is refused', async () => {
  expect((await a.put(`/integrations/${CHANNEL}/custom-name`, { data: { name: 'x'.repeat(101) } })).status()).toBe(400);
});
