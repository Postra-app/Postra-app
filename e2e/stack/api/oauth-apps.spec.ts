import { APIRequestContext, expect, request, test } from '@playwright/test';
import { BACKEND_URL, addMember, database, throwawayOrg } from '../helpers';

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

test('E2E-08-25: a plain member cannot approve an app for the organisation', async () => {
  // An approved app acts as an admin of the organisation (SUPERADMIN on the
  // public API and MCP), so approving one is for admins, like the API key.
  const prisma = database();
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  const member = await addMember(prisma, owner.orgId, 'USER');
  try {
    const created = await owner.api.post('/user/oauth-app', {
      data: { name: 'Stack OAuth app', redirectUrl: 'https://example.com/callback' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { clientId } = await created.json();
    const res = await member.api.post('/oauth/authorize', {
      data: { client_id: clientId, state: 'm1', action: 'approve' },
    });
    expect(res.status()).toBe(403);
  } finally {
    await member.remove();
    await owner.remove();
    await prisma.$disconnect();
  }
});

test('E2E-08-25: a token stops working once whoever approved it leaves the team', async () => {
  const prisma = database();
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  const admin = await addMember(prisma, owner.orgId, 'ADMIN');
  try {
    const created = await owner.api.post('/user/oauth-app', {
      data: { name: 'Stack OAuth app', redirectUrl: 'https://example.com/callback' },
    });
    const { clientId, clientSecret } = await created.json();
    const code = await approve(admin.api, clientId, 'a1');
    const token = await exchange(owner.api, clientId, clientSecret, code);
    expect(token.status(), await token.text()).toBe(201);
    const asApp = await publicApi((await token.json()).access_token);
    expect((await asApp.get('integrations')).status()).toBe(200);

    // The token used to keep acting for the organisation after its owner
    // removed the person who approved it.
    expect((await owner.api.delete(`/settings/team/${admin.userId}`)).status()).toBe(200);
    expect((await asApp.get('integrations')).status()).toBe(401);
    await asApp.dispose();
  } finally {
    await admin.remove();
    await owner.remove();
    await prisma.$disconnect();
  }
});

test("E2E-08-29: an app's picture must be the organisation's own media; approved apps show no secrets", async () => {
  const prisma = database();
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  const other = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  try {
    const foreign = await prisma.media.create({
      data: { name: 'theirs.png', path: 'https://cdn.example.com/theirs.png', organizationId: other.orgId, canvasJson: '{"secret":"design"}' },
    });
    // Someone else's media id came back as the app's picture, whole record.
    const refused = await owner.api.post('/user/oauth-app', {
      data: { name: 'Stack OAuth app', redirectUrl: 'https://example.com/callback', pictureId: foreign.id },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.text()).not.toContain('design');

    const own = await prisma.media.create({
      data: { name: 'ours.png', path: 'https://cdn.example.com/ours.png', organizationId: owner.orgId, canvasJson: '{"secret":"ours"}' },
    });
    const created = await owner.api.post('/user/oauth-app', {
      data: { name: 'Stack OAuth app', redirectUrl: 'https://example.com/callback', pictureId: own.id },
    });
    expect(created.status(), await created.text()).toBe(201);
    const app = await created.json();
    expect(app.picture).toEqual({ id: own.id, path: own.path });

    // The Approved Apps list: what the page shows, no encrypted secret or token.
    const code = await approve(owner.api, app.clientId, 'p1');
    expect((await exchange(owner.api, app.clientId, app.clientSecret, code)).status()).toBe(201);
    const approved = await (await owner.api.get('/user/approved-apps')).json();
    expect(approved).toHaveLength(1);
    expect(Object.keys(approved[0]).sort()).toEqual(['createdAt', 'id', 'oauthApp']);
    expect(Object.keys(approved[0].oauthApp).sort()).toEqual(['description', 'id', 'name', 'picture']);
  } finally {
    await owner.remove();
    await other.remove();
    await prisma.$disconnect();
  }
});
