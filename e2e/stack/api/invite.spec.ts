import { APIRequestContext, expect, test } from '@playwright/test';
import { anonymous, signedIn } from '../helpers';
import { USERS } from '../seed';

// Invite links: an agency sends its client a link, the client connects their
// own channel into the agency's organisation — without a Postra account.
// Every invite used to end in 401 "You must be signed in to connect a
// channel", after the client had already consented (production, 2026-10-01).
//
// The callback's guard is still the point: a `state` minted by someone else
// and carried to a victim must not connect the victim's channel. What lets an
// invitee through is a cookie set in their own browser when they follow the
// invite; these tests pin both halves.

const invite = async (agency: APIRequestContext) => {
  const res = await agency.get('/integrations/social/mastodon?invite=true');
  expect(res.status()).toBe(200);
  const { url } = await res.json();
  const token = new URL(url).pathname.split('/').pop()!;
  return token;
};

// Follows "Continue" on the invite page; returns the provider URL's state.
const follow = async (browser: APIRequestContext, token: string) => {
  const res = await browser.get(`/integrations/invite/${token}/go?provider=mastodon`, {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(302);
  const location = res.headers()['location'];
  expect(location).toContain(new URL(process.env.MASTODON_URL || 'http://localhost:58080').host);
  return new URL(location).searchParams.get('state')!;
};

const complete = (browser: APIRequestContext, state: string, code: string) =>
  browser.post('/integrations/social-connect/mastodon', {
    data: { state, code, timezone: '0' },
  });

const channelsOfA = async (a: APIRequestContext) =>
  (await (await a.get('/integrations/list')).json()).integrations as {
    id: string;
    name: string;
  }[];

const removeFromA = async (a: APIRequestContext, name: string) => {
  for (const channel of (await channelsOfA(a)).filter((c) => c.name === name)) {
    await a.delete('/integrations', { data: { id: channel.id } });
  }
};

test('the invite page learns who is inviting, and never the provider URL', async () => {
  const a = await signedIn('a');
  const client = await anonymous();
  const body = await (await client.get(`/integrations/invite/${await invite(a)}`)).json();
  expect(body).toEqual({ valid: true, organization: USERS.a.org });
  expect(JSON.stringify(body)).not.toContain('state=');

  expect(await (await client.get('/integrations/invite/no-such-token')).json()).toEqual({
    err: true,
  });
  await a.dispose();
  await client.dispose();
});

test('a client without an account connects through the invite, once', async () => {
  const a = await signedIn('a');
  const client = await anonymous();
  const state = await follow(client, await invite(a));

  const res = await complete(client, state, 'invitee1');
  expect(res.status(), await res.text()).toBe(201);
  expect((await channelsOfA(a)).map((c) => c.name)).toContain('Invited invitee1');

  // The same callback again is spent.
  expect((await complete(client, state, 'invitee1')).status()).toBe(400);

  await removeFromA(a, 'Invited invitee1');
  await a.dispose();
  await client.dispose();
});

test('a provider URL lifted from an invite and forwarded connects nothing', async () => {
  // The attack the guard exists for: whoever follows the invite gets the
  // provider URL, and sends it to someone else. That someone has no cookie.
  const a = await signedIn('a');
  const lifter = await anonymous();
  const victim = await anonymous();
  const b = await signedIn('b');
  const state = await follow(lifter, await invite(a));

  expect((await complete(victim, state, 'victim1')).status()).toBe(401);
  // Signed in elsewhere is not a way round it either.
  expect((await complete(b, state, 'victim1')).status()).toBe(403);
  expect((await channelsOfA(a)).map((c) => c.name)).not.toContain('Invited victim1');

  await a.dispose();
  await lifter.dispose();
  await victim.dispose();
  await b.dispose();
});

test("one invite's cookie does not open another invite's flow", async () => {
  const a = await signedIn('a');
  const client = await anonymous();
  const other = await anonymous();
  await follow(client, await invite(a));
  const otherState = await follow(other, await invite(a));

  expect((await complete(client, otherState, 'cross1')).status()).toBe(401);

  await a.dispose();
  await client.dispose();
  await other.dispose();
});

test('an invited client with their own Postra account still connects into the inviting org', async () => {
  const a = await signedIn('a');
  const clientWithAccount = await signedIn('b');
  const state = await follow(clientWithAccount, await invite(a));

  const res = await complete(clientWithAccount, state, 'invitee2');
  expect(res.status(), await res.text()).toBe(201);
  expect((await channelsOfA(a)).map((c) => c.name)).toContain('Invited invitee2');
  const ofB = await (await clientWithAccount.get('/integrations/list')).json();
  expect(JSON.stringify(ofB)).not.toContain('Invited invitee2');

  await removeFromA(a, 'Invited invitee2');
  await a.dispose();
  await clientWithAccount.dispose();
});

test('an expired invite sends the browser back to the page that says so', async () => {
  const client = await anonymous();
  const res = await client.get('/integrations/invite/gone/go?provider=mastodon', {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(302);
  expect(res.headers()['location']).toMatch(/\/connect\/mastodon\/gone$/);
  // Anything that is not a provider name goes nowhere odd.
  const odd = await client.get('/integrations/invite/gone/go?provider=//evil.example', {
    maxRedirects: 0,
  });
  expect(odd.headers()['location']).toMatch(/\/connect\/channel\/gone$/);
  await client.dispose();
});
