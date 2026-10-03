import { expect, test } from '@playwright/test';
import { anonymous, signedIn } from '../helpers';
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
