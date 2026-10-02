import { APIRequestContext, expect, test } from '@playwright/test';
import { channelOf, signedIn } from '../helpers';
import { ORG_C } from '../seed';

// Seats and roles in a team (Plan/testing.md §9). team_members counts every
// seat including the owner: Starter 1, Pro 2, Business 5. Organisation C is a
// Business agency with all five seats taken: owner, one ADMIN, three USERs.
// Serial: the last tests free a seat, the first need the team full.
test.describe.configure({ mode: 'serial' });

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const invite = (role: 'USER' | 'ADMIN' = 'USER') => ({
  data: { email: `invitee-${Date.now()}@example.com`, role, sendEmail: false },
});

let owner: APIRequestContext;
let admin: APIRequestContext;
let user: APIRequestContext;
test.beforeAll(async () => {
  owner = await signedIn('c-owner');
  admin = await signedIn('c-admin');
  user = await signedIn('c-user');
});
test.afterAll(async () => {
  await owner.dispose();
  await admin.dispose();
  await user.dispose();
});

test('Starter cannot invite anyone: the owner is its only seat', async () => {
  const starter = await signedIn('b');
  const res = await starter.post('/settings/team', invite());
  expect(res.status()).toBe(402);
  expect((await res.json()).message).toContain('not included in your current plan');
  await starter.dispose();
});

test('Pro with the owner and one member cannot invite a third', async () => {
  const pro = await signedIn('a');
  expect((await pro.post('/settings/team', invite())).status()).toBe(402);
  await pro.dispose();
});

test('Business with five seats taken refuses the sixth, from the owner and an admin', async () => {
  expect((await owner.post('/settings/team', invite())).status()).toBe(402);
  expect((await admin.post('/settings/team', invite('ADMIN'))).status()).toBe(402);
  const team = await (await owner.get('/settings/team')).json();
  expect(JSON.stringify(team)).toContain(ORG_C.leaver.email);
});

// E2E-02-02: a role that is too low is 403, a plan that is too small is 402.
// [method, path, body, USER, ADMIN, bug?]. A member works with channels, customers
// and webhooks like anyone in the calendar; the team, billing, the API key
// and organisation settings are for admins.
type Row = [
  'get' | 'post' | 'put' | 'delete',
  string,
  Record<string, unknown> | undefined,
  number,
  number,
  string?,
];
const MATRIX: Row[] = [
  // team (invite: an admin passes the role check and meets the full team)
  ['get', '/settings/team', undefined, 403, 200],
  ['post', '/settings/team', invite().data, 403, 402],
  [
    'delete',
    `/settings/team/${UNKNOWN}`,
    undefined,
    403,
    404,
    // BUG: deleteTeamMember throws a bare Error('User is not part of this organization').
    'an unknown member is 500',
  ],
  // billing
  ['get', '/user/subscription', undefined, 403, 200],
  // organisation settings and the developer app
  ['post', '/settings/shortlink', { shortlink: 'ASK' }, 403, 201],
  ['get', '/user/oauth-app', undefined, 403, 200],
  // channels
  ['get', '/integrations/list', undefined, 200, 200],
  // BUG: deleteChannel's prisma update throws P2025 for a channel the org lacks.
  ['delete', '/integrations', { id: UNKNOWN }, 404, 404, 'an unknown channel is 500'],
  ['delete', '/integrations', { id: channelOf('a') }, 404, 404, 'a foreign channel is 500'],
  // customers
  ['get', '/integrations/customers', undefined, 200, 200],
  ['put', `/integrations/${UNKNOWN}/customer-name`, { name: 'x' }, 404, 404],
  ['put', `/integrations/${channelOf('a')}/customer-name`, { name: 'x' }, 404, 404],
  // webhooks
  ['get', '/webhooks', undefined, 200, 200],
  ['delete', `/webhooks/${UNKNOWN}`, undefined, 404, 404],
];

for (const [method, path, body, forUser, forAdmin, bug] of MATRIX) {
  const target = body && 'id' in body ? `${path} ${body.id}` : path;
  test(`role matrix: ${method.toUpperCase()} ${target} is ${forUser} for a USER, ${forAdmin} for an ADMIN`, async () => {
    test.fail(!!bug, bug);
    const options = body ? { data: body } : undefined;
    const asUser = await user[method](path, options);
    expect(asUser.status(), `USER: ${await asUser.text()}`).toBe(forUser);
    const asAdmin = await admin[method](path, options);
    expect(asAdmin.status(), `ADMIN: ${await asAdmin.text()}`).toBe(forAdmin);
  });
}

test('role matrix: only an admin may rotate the API key, and only an admin sees it', async () => {
  expect((await user.post('/user/api-key/rotate')).status()).toBe(403);
  expect((await (await user.get('/user/self')).json()).publicApi ?? '').toBe('');

  const before = (await (await admin.get('/user/self')).json()).publicApi;
  expect(before).toBeTruthy();
  expect((await admin.post('/user/api-key/rotate')).status()).toBe(201);
  const after = (await (await admin.get('/user/self')).json()).publicApi;
  expect(after).toBeTruthy();
  expect(after).not.toBe(before);
});

test('an admin cannot remove the owner', async () => {
  // BUG: deleteTeamMember refuses with a bare Error('You do not have permission…') — 500.
  test.fail();
  const team: { users: { role: string; user: { id: string; email: string } }[] } =
    await (await owner.get('/settings/team')).json();
  const ownerRow = team.users.find((u) => u.user.email === ORG_C.owner.email)!;
  const res = await admin.delete(`/settings/team/${ownerRow.user.id}`);
  expect(res.status(), await res.text()).toBe(403);
  expect((await owner.get('/settings/team')).status()).toBe(200);
});

test('a removed member is signed out of the organisation on their very next request', async () => {
  const leaver = await signedIn('c-leaver');
  expect((await leaver.get('/integrations/list')).status()).toBe(200);

  const team: { users: { user: { id: string; email: string } }[] } =
    await (await owner.get('/settings/team')).json();
  const row = team.users.find((u) => u.user.email === ORG_C.leaver.email)!;
  expect((await owner.delete(`/settings/team/${row.user.id}`)).status()).toBe(200);

  // Same cookie, no waiting for the 30 s auth cache.
  const after = await leaver.get('/integrations/list');
  expect([401, 403]).toContain(after.status());
  expect(JSON.stringify(await after.text())).not.toContain(ORG_C.channel.id);
  await leaver.dispose();
});

test('Business with a seat free can invite again', async () => {
  const res = await owner.post('/settings/team', invite());
  expect(res.status(), await res.text()).toBe(201);
  expect((await res.json()).url).toContain('/?org=');
});
