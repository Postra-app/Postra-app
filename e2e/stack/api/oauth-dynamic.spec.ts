import { APIRequestContext, expect, request, test } from '@playwright/test';
import { createHash, randomBytes } from 'crypto';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// ChatGPT and Claude connect to Postra's MCP server by OAuth (MCP
// authorization spec): they register themselves (RFC 7591), send the person
// to Postra's consent screen with PKCE, and trade the code for a pos_ token.
// Ported from upstream eabac3d3d + 0d8d0f228 with an allowlist of redirect
// addresses. The connectors used to get only the API key in the URL.

const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const prisma = database();
test.afterAll(() => prisma.$disconnect());

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

const register = (api: APIRequestContext, data: object) => api.post('/oauth/register', { data });

test('the server says how to register and log in', async () => {
  const anon = await request.newContext({ baseURL: BACKEND_URL });
  const meta = await (await anon.get('/.well-known/oauth-authorization-server')).json();
  expect(meta.registration_endpoint).toMatch(/\/oauth\/register$/);
  expect(meta.token_endpoint_auth_methods_supported).toEqual(expect.arrayContaining(['none', 'client_secret_post']));
  expect(meta.code_challenge_methods_supported).toEqual(['S256']);
  await anon.dispose();
});

test('a connector registers, the person approves, the token works on MCP', async () => {
  const anon = await request.newContext({ baseURL: BACKEND_URL });
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  try {
    const registered = await register(anon, {
      client_name: 'Claude',
      redirect_uris: [CLAUDE],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
    expect(registered.status(), await registered.text()).toBe(201);
    const client = await registered.json();
    expect(client.client_id).toMatch(/^pca_/);
    expect(client).not.toHaveProperty('client_secret');
    expect(client.redirect_uris).toEqual([CLAUDE]);

    const { verifier, challenge } = pkce();
    const q = (extra: Record<string, string>) =>
      new URLSearchParams({
        client_id: client.client_id,
        response_type: 'code',
        state: 'st1',
        redirect_uri: CLAUDE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...extra,
      }).toString();

    const consent = await owner.api.get(`/oauth/authorize?${q({})}`);
    expect(consent.status(), await consent.text()).toBe(200);
    expect((await consent.json()).app).toMatchObject({ name: 'Claude', dynamic: true });

    // A dynamic client must use PKCE, and only an address it registered.
    expect((await owner.api.get(`/oauth/authorize?${q({ code_challenge: '' })}`)).status()).toBe(400);
    expect(
      (await owner.api.get(`/oauth/authorize?${q({ redirect_uri: 'https://claude.ai/other' })}`)).status()
    ).toBe(400);

    const approved = await owner.api.post('/oauth/authorize', {
      data: {
        client_id: client.client_id,
        state: 'st1',
        action: 'approve',
        redirect_uri: CLAUDE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      },
    });
    expect(approved.status(), await approved.text()).toBe(201);
    const back = new URL((await approved.json()).redirect);
    expect(back.origin + back.pathname).toBe(CLAUDE);
    expect(back.searchParams.get('state')).toBe('st1');
    const code = back.searchParams.get('code')!;

    const exchange = (extra: object) =>
      anon.post('/oauth/token', {
        data: { grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: CLAUDE, code_verifier: verifier, ...extra },
      });
    // The redirect_uri of the exchange must be the one the code was sent to.
    expect((await exchange({ redirect_uri: 'https://chatgpt.com/x' })).status()).toBe(400);
    const token = await exchange({});
    expect(token.status(), await token.text()).toBe(201);
    const { access_token } = await token.json();
    expect(access_token).toMatch(/^pos_/);

    const mcp = await anon.post('/mcp', {
      headers: { authorization: `Bearer ${access_token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude', version: '0' } } },
    });
    expect(mcp.status(), await mcp.text()).toBe(200);
  } finally {
    await anon.dispose();
    await owner.remove();
  }
});

test('registration refuses addresses outside the allowlist and clients without a redirect', async () => {
  const anon = await request.newContext({ baseURL: BACKEND_URL });
  try {
    for (const redirect_uris of [['https://evil.example/callback'], ['http://claude.ai/cb'], []]) {
      const res = await register(anon, { client_name: 'X', redirect_uris, token_endpoint_auth_method: 'none' });
      expect(res.status(), JSON.stringify(redirect_uris)).toBe(400);
    }
  } finally {
    await anon.dispose();
  }
});

test("a registered connector does not become the organisation's own OAuth app", async () => {
  const anon = await request.newContext({ baseURL: BACKEND_URL });
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    await register(anon, { client_name: 'Claude', redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' });
    // Settings → Developers → Apps still shows no app, and one can be made.
    expect(await (await owner.api.get('/user/oauth-app')).json()).toBe(false);
    const created = await owner.api.post('/user/oauth-app', {
      data: { name: 'Mine', redirectUrl: 'https://example.com/callback' },
    });
    expect(created.status(), await created.text()).toBe(201);
  } finally {
    await anon.dispose();
    await owner.remove();
  }
});
