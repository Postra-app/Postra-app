import { expect, request, test } from '@playwright/test';
import { sign } from 'jsonwebtoken';
import { BACKEND_URL, anonymous, database, signedIn } from '../helpers';
import { USERS } from '../seed';

test.describe('auth', () => {
  test('wrong password is refused without a session cookie', async () => {
    const api = await anonymous();
    const res = await api.post('/auth/login', {
      data: { email: USERS.a.email, password: 'wrong-password', provider: 'LOCAL' },
    });
    expect(res.status()).toBe(400);
    expect(res.headers()['set-cookie'] ?? '').not.toContain('auth=ey');
    await api.dispose();
  });

  test('unknown e-mail answers like a wrong password', async () => {
    const api = await anonymous();
    const res = await api.post('/auth/login', {
      data: { email: 'nobody@example.com', password: 'whatever-1', provider: 'LOCAL' },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test('protected routes refuse a request without a session', async () => {
    const api = await anonymous();
    for (const path of ['/posts/tags', '/integrations/list', '/user/self']) {
      const res = await api.get(path);
      expect(res.status(), path).toBe(401);
    }
    await api.dispose();
  });

  test('a signed-in user sees their own organisation only', async () => {
    const api = await signedIn('a');
    const res = await api.get('/user/organizations');
    expect(res.status()).toBe(200);
    const orgs: { name: string }[] = await res.json();
    expect(orgs.map((o) => o.name)).toEqual([USERS.a.org]);
    await api.dispose();
  });
});

// 2.2.11: the state of a sign-in with Google works once. The first use gets
// past the state check (and fails later, at Google, on a made-up code); the
// second, and a made-up state, stop at the state.
test('a Google sign-in state works once', async () => {
  const api = await anonymous();
  const link = await (await api.get('/auth/oauth/GOOGLE')).text();
  const state = new URL(link.replace(/^"|"$/g, '')).searchParams.get('state');
  expect(state).toMatch(/^auth-/);
  const exists = (s: string) => api.post('/auth/oauth/GOOGLE/exists', { data: { code: 'made-up', state: s } });

  const first = await exists(state!);
  expect(first.status()).toBe(400);
  expect(await first.text()).toContain('Sign-in with this provider failed');
  for (const s of [state!, 'auth-made-up']) {
    const res = await exists(s);
    // Was a 500 for both.
    expect(res.status(), s).toBe(400);
    expect(await res.text()).toBe('Invalid or expired state');
  }
  await api.dispose();
});

test('E2E-02-27: a link from a mail (password reset, activation) is not a session', async () => {
  // The reset link carried the same id and tokenVersion a session does, under
  // the default 30-day JWT expiry: a leaked, unused link signed its holder in
  // for a month. The activation link was the session token itself.
  const prisma = database();
  try {
    const user = await prisma.user.findFirstOrThrow({ where: { email: USERS.a.email } });
    const secret = process.env.JWT_SECRET!;
    const links = {
      'reset link as minted until now': sign(
        { id: user.id, tokenVersion: user.tokenVersion, expires: '2099-01-01 00:00:00' },
        secret,
        { expiresIn: '30d' }
      ),
      'reset link': sign(
        { id: user.id, tokenVersion: user.tokenVersion, expires: '2099-01-01 00:00:00', purpose: 'reset' },
        secret,
        { expiresIn: '20m' }
      ),
      'activation link': sign(
        { id: user.id, email: user.email, activated: false, purpose: 'activate' },
        secret,
        { expiresIn: '30d' }
      ),
    };
    for (const [what, token] of Object.entries(links)) {
      const asLink = await request.newContext({ baseURL: BACKEND_URL, extraHTTPHeaders: { auth: token } });
      expect((await asLink.get('/user/self')).status(), what).not.toBe(200);
      await asLink.dispose();
    }

    // A real session for the same user still works.
    const session = sign({ id: user.id, email: user.email, tokenVersion: user.tokenVersion }, secret, {
      expiresIn: '30d',
    });
    const asUser = await request.newContext({ baseURL: BACKEND_URL, extraHTTPHeaders: { auth: session } });
    expect((await asUser.get('/user/self')).status()).toBe(200);
    await asUser.dispose();
  } finally {
    await prisma.$disconnect();
  }
});

test('E2E-02-29: a wallet sign-in with a bad signature gets no account', async () => {
  // An unverifiable wallet token came back as { id: '', email: '' }, which
  // passed as a user: the first one created an account with an empty
  // identity and every later bad signature signed into it.
  const prisma = database();
  try {
    const garbage = (n: number) =>
      Buffer.from(JSON.stringify({ publicKey: `x${n}`, challenge: 'y', signature: 'zz' })).toString('base64');
    const attempts = [
      ['/auth/register', { provider: 'WALLET', providerToken: garbage(1), company: 'Stack wallet', termsAccepted: true }],
      ['/auth/register', { provider: 'WALLET', providerToken: garbage(2), company: 'Stack wallet', termsAccepted: true }],
    ] as const;
    for (const [path, data] of attempts) {
      const api = await anonymous();
      const res = await api.post(path, { data });
      expect(res.status(), `${path}: ${await res.text()}`).toBeGreaterThanOrEqual(400);
      expect(res.status()).toBeLessThan(500);
      await api.dispose();
    }
    expect(await prisma.user.count({ where: { providerName: 'WALLET', providerId: '' } })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});
