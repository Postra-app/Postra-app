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
