import { APIRequestContext, expect, test } from '@playwright/test';
import { createDraft, signedIn } from '../helpers';

// Agencies give clients and staff plain member accounts (role USER). A member
// works in the calendar like anyone else, but managing the team, billing,
// settings and the organisation's API key is for the organisation's admins.

let owner: APIRequestContext;
let member: APIRequestContext;
test.beforeAll(async () => {
  owner = await signedIn('a');
  member = await signedIn('member');
});
test.afterAll(async () => {
  await owner.dispose();
  await member.dispose();
});

test('a member can create and delete a draft in the shared calendar', async () => {
  const post = await createDraft(member, 'a', `[stack] member draft ${Date.now()}`);
  expect((await member.delete(`/posts/${post.group}`)).status()).toBe(200);
});

test('a member cannot read or manage the team', async () => {
  expect((await member.get('/settings/team')).status()).toBe(403);
  expect(
    (
      await member.post('/settings/team', {
        data: { email: 'someone@example.com', role: 'ADMIN', sendEmail: false },
      })
    ).status()
  ).toBe(403);
  expect(
    (await member.delete('/settings/team/00000000-0000-4000-8000-000000000000')).status()
  ).toBe(403);
});

test('a member cannot change organisation settings or billing', async () => {
  expect(
    (await member.post('/settings/shortlink', { data: { shortlink: 'NO' } })).status()
  ).toBe(403);
  expect((await member.get('/user/subscription')).status()).toBe(403);
  expect((await member.get('/billing/portal')).status()).toBe(403);
  expect((await member.post('/billing/cancel', { data: { feedback: 'x' } })).status()).toBe(403);
});

test("a member never sees or rotates the organisation's API key", async () => {
  const self = await (await member.get('/user/self')).json();
  expect(self.publicApi ?? '').toBe('');
  expect((await member.post('/user/api-key/rotate')).status()).toBe(403);

  // The owner does see it.
  const ownerSelf = await (await owner.get('/user/self')).json();
  expect(ownerSelf.publicApi).toBeTruthy();
});

test('E2E-08-24: the organisation list every browser loads carries no API key or Stripe id', async () => {
  // /user/self hid the key from members; the organisation switcher's list
  // handed it (a SUPERADMIN credential for the public API and MCP) and the
  // Stripe customer id to everyone, members included.
  for (const who of [member, owner]) {
    const res = await who.get('/user/organizations');
    expect(res.status()).toBe(200);
    const orgs = (await res.json()) as Record<string, unknown>[];
    expect(orgs.length).toBeGreaterThan(0);
    for (const org of orgs) {
      expect(org).toHaveProperty('id');
      expect(org).toHaveProperty('name');
      expect(org).not.toHaveProperty('apiKey');
      expect(org).not.toHaveProperty('paymentId');
      // Only what the switchers read (web and mobile): a column added to
      // Organization later must not reach every member by default.
      expect(Object.keys(org).sort()).toEqual(
        ['id', 'name', 'subscription', 'users'].sort()
      );
    }
  }
});

test('a full Pro team: the owner still sees and manages it, but cannot invite', async () => {
  // Pro = owner + 1 seat, and the member fills it. Only the invite needs a
  // free seat; seeing the team and removing someone must keep working, or a
  // full team could never make room.
  const invite = await owner.post('/settings/team', {
    data: { email: 'third@example.com', role: 'USER', sendEmail: false },
  });
  expect(invite.status()).toBe(402);
  expect((await owner.get('/settings/team')).status()).toBe(200);
});

test('the owner reads the team and sees the member in it', async () => {
  const res = await owner.get('/settings/team');
  expect(res.status()).toBe(200);
  expect(JSON.stringify(await res.json())).toContain('member-a@example.com');
});
