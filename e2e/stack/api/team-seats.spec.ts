import { APIRequestContext, expect, test } from '@playwright/test';
import { channelOf, database, signedIn, throwawayOrg } from '../helpers';
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
// [method, path, body, USER, ADMIN]. A member works with posts and channels
// in the calendar; deleting, disabling or moving channels between agency
// clients, webhooks, the team, billing, the API key and organisation settings
// are for admins.
type Row = [
  'get' | 'post' | 'put' | 'delete',
  string,
  Record<string, unknown> | undefined,
  number,
  number,
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
    404],
  // billing
  ['get', '/user/subscription', undefined, 403, 200],
  // organisation settings and the developer app
  ['post', '/settings/shortlink', { shortlink: 'ASK' }, 403, 201],
  ['get', '/user/oauth-app', undefined, 403, 200],
  // channels
  ['get', '/integrations/list', undefined, 200, 200],
  ['delete', '/integrations', { id: UNKNOWN }, 403, 404],
  ['delete', '/integrations', { id: channelOf('a') }, 403, 404],
  // customers
  ['get', '/integrations/customers', undefined, 200, 200],
  ['put', `/integrations/${UNKNOWN}/customer-name`, { name: 'x' }, 403, 404],
  ['put', `/integrations/${channelOf('a')}/customer-name`, { name: 'x' }, 403, 404],
  ['put', `/integrations/${UNKNOWN}/group`, { group: 'x' }, 403, 404],
  ['post', '/integrations/disable', { id: UNKNOWN }, 403, 404],
  ['post', '/integrations/enable', { id: UNKNOWN }, 403, 404],
  // webhooks
  ['get', '/webhooks', undefined, 200, 200],
  ['delete', `/webhooks/${UNKNOWN}`, undefined, 403, 404],
  ['post', '/webhooks', { name: 'x', url: 'https://example.com/hook', integrations: [] }, 403, 201],
];

for (const [method, path, body, forUser, forAdmin] of MATRIX) {
  const target = body && 'id' in body ? `${path} ${body.id}` : path;
  test(`role matrix: ${method.toUpperCase()} ${target} is ${forUser} for a USER, ${forAdmin} for an ADMIN`, async () => {
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

test('E2E-02-31: a used team invite cannot be used again, by anyone', async () => {
  // The spent mark sat in one field of the user who used it: their next
  // invite overwrote it and the first link worked again for anyone, with the
  // role it carried.
  const prisma = database();
  const agency = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const other = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const first = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const second = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const tokenOf = async (inviter: typeof agency, role: 'ADMIN' | 'USER') => {
    const res = await inviter.api.post('/settings/team', {
      data: { email: `someone-${Date.now()}@example.com`, role, sendEmail: false },
    });
    expect(res.status(), await res.text()).toBe(201);
    return new URL((await res.json()).url, 'https://x').searchParams.get('org')!;
  };
  try {
    const adminInvite = await tokenOf(agency, 'ADMIN');
    const join = async (who: typeof agency, token: string) =>
      (await (await who.api.post('/user/join-org', { data: { org: token } })).json()).id as string | null;

    // The owner opening their own link adds nobody and spends nothing.
    expect(await join(agency, adminInvite)).toBeNull();
    expect(await join(first, adminInvite)).toBe(agency.orgId);
    // The same person then joins somewhere else.
    expect(await join(first, await tokenOf(other, 'USER'))).toBe(other.orgId);
    // Someone else holding the first link must not get in as ADMIN.
    expect(await join(second, adminInvite)).toBeNull();
  } finally {
    for (const o of [agency, other, first, second]) await o.remove();
    await prisma.$disconnect();
  }
});

// BILL-5: seats were checked when an invite was sent, and sending one
// reserves nothing — a Pro owner could send several and all of them got in.
test('Pro: two invites sent with one seat free, only the first person gets in', async () => {
  const prisma = database();
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const first = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const second = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const tokenOf = async () => {
    const res = await pro.api.post('/settings/team', invite());
    expect(res.status(), await res.text()).toBe(201);
    return new URL((await res.json()).url, 'https://x').searchParams.get('org')!;
  };
  try {
    const [one, two] = [await tokenOf(), await tokenOf()];
    const join = async (who: typeof pro, token: string) =>
      (await (await who.api.post('/user/join-org', { data: { org: token } })).json()).id as string | null;
    expect(await join(first, one)).toBe(pro.orgId);
    expect(await join(second, two)).toBeNull();
    expect(await prisma.userOrganization.count({ where: { organizationId: pro.orgId, disabled: false } })).toBe(2);
  } finally {
    for (const o of [pro, first, second]) await o.remove();
    await prisma.$disconnect();
  }
});
