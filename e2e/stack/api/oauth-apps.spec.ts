import { APIRequestContext, expect, request, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// "Sign in with Postra" for third-party apps (Settings → Developers, hidden
// until the SDK ships — the routes are live): an owner registers an app, a
// user approves it, the app trades the code for a pos_ token that works on the
// public API, and revoking it in Approved Apps ends that token at once.

const publicApi = (token: string) =>
  request.newContext({
    baseURL: `${BACKEND_URL}/public/v1/`,
    extraHTTPHeaders: { authorization: token },
  });

const approve = async (api: APIRequestContext, clientId: string, state: string) => {
  const res = await api.post('/oauth/authorize', {
    data: { client_id: clientId, state, action: 'approve' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const redirect = new URL((await res.json()).redirect);
  expect(redirect.origin + redirect.pathname).toBe('https://example.com/callback');
  expect(redirect.searchParams.get('state')).toBe(state);
  return redirect.searchParams.get('code')!;
};

const exchange = (api: APIRequestContext, clientId: string, secret: string, code: string) =>
  api.post('/oauth/token', {
    data: { grant_type: 'authorization_code', code, client_id: clientId, client_secret: secret },
  });

test('register, approve, exchange, call the public API, revoke', async () => {
  const prisma = database();
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  try {
    const created = await owner.api.post('/user/oauth-app', {
      data: { name: 'Stack OAuth app', redirectUrl: 'https://example.com/callback' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { clientId, clientSecret } = await created.json();
    expect(clientId).toMatch(/^pca_/);
    expect(clientSecret).toMatch(/^pcs_/);
    // The secret is shown once; reading the app back never returns it.
    expect(JSON.stringify(await (await owner.api.get('/user/oauth-app')).json())).not.toContain(
      clientSecret
    );

    const consent = await owner.api.get(
      `/oauth/authorize?client_id=${clientId}&response_type=code&state=s1`
    );
    expect(consent.status()).toBe(200);
    expect((await consent.json()).app.name).toBe('Stack OAuth app');

    const denied = await owner.api.post('/oauth/authorize', {
      data: { client_id: clientId, state: 's0', action: 'deny' },
    });
    expect((await denied.json()).redirect).toBe(
      'https://example.com/callback?error=access_denied&state=s0'
    );

    const code = await approve(owner.api, clientId, 's1');
    expect((await exchange(owner.api, clientId, 'pcs_wrong', code)).status()).toBe(401);
    const token = await exchange(owner.api, clientId, clientSecret, code);
    expect(token.status(), await token.text()).toBe(201);
    const body = await token.json();
    expect(body.access_token).toMatch(/^pos_/);
    // The organisation's Stripe customer id is nothing an outside app needs.
    expect(body).not.toHaveProperty('cus');
    // A code works once.
    expect((await exchange(owner.api, clientId, clientSecret, code)).status()).toBe(400);

    const asApp = await publicApi(body.access_token);
    const channels = await asApp.get('integrations');
    expect(channels.status()).toBe(200);
    expect((await channels.json()).map((c: { id: string }) => c.id)).toEqual(owner.channelIds);

    const approved = (await (await owner.api.get('/user/approved-apps')).json()) as {
      id: string;
    }[];
    expect(approved).toHaveLength(1);
    // Someone else's (or no) authorisation: refused, not a server error.
    expect(
      (await owner.api.delete('/user/approved-apps/00000000-0000-4000-8000-000000000000')).status()
    ).toBe(404);
    expect((await owner.api.delete(`/user/approved-apps/${approved[0].id}`)).status()).toBe(200);
    expect((await asApp.get('integrations')).status()).toBe(401);
    await asApp.dispose();

    // A rotated secret replaces the old one.
    const rotated = await owner.api.post('/user/oauth-app/rotate-secret');
    const { clientSecret: newSecret } = await rotated.json();
    const code2 = await approve(owner.api, clientId, 's2');
    expect((await exchange(owner.api, clientId, clientSecret, code2)).status()).toBe(401);
    expect((await exchange(owner.api, clientId, newSecret, code2)).status()).toBe(201);
  } finally {
    await owner.remove();
    await prisma.$disconnect();
  }
});
