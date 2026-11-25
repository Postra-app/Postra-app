import { expect, request, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// Guessing a password through the sign-in form, against the real backend and
// Redis: one address gets five tries in fifteen minutes, and an account takes
// ten wrong passwords from anywhere before it stops accepting even the right
// one for fifteen minutes. Locally the backend reads the client address from
// the last X-Forwarded-For entry, as it does behind the load balancer, so a
// different header stands for a different machine.
const from = (ip: string) =>
  request.newContext({ baseURL: BACKEND_URL, extraHTTPHeaders: { 'x-forwarded-for': ip } });

const signIn = (api: Awaited<ReturnType<typeof from>>, email: string, password: string) =>
  api.post('/auth/login', { data: { provider: 'LOCAL', email, password } });

test('one address gets five tries, then 429', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const api = await from(`198.51.100.${(Date.now() % 200) + 1}`);
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await signIn(api, org.email, `wrong-${i}-Aa1`)).status());
    }
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
    // Throttled before the password is looked at: the right one is refused too.
    expect((await signIn(api, org.email, org.password)).status()).toBe(429);
  } finally {
    await api.dispose();
    await org.remove();
    await prisma.$disconnect();
  }
});

test('an account takes ten wrong passwords from any number of addresses, then refuses even the right one', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const base = (Date.now() % 50) * 5;
  const contexts: Awaited<ReturnType<typeof from>>[] = [];
  try {
    // Ten wrong passwords, two from each of five addresses: no address
    // reaches its own limit.
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) contexts.push(await from(`203.0.113.${base + i / 2 + 1}`));
      const res = await signIn(contexts[contexts.length - 1], org.email, `guess-${i}-Aa1`);
      expect(res.status(), await res.text()).toBe(400);
    }
    const fresh = await from(`192.0.2.${base + 1}`);
    contexts.push(fresh);
    const right = await signIn(fresh, org.email, org.password);
    expect(right.status()).toBe(400);
    expect(await right.text()).toBe('Too many failed login attempts. Please try again in a few minutes.');
    expect(right.headers()['set-cookie'] ?? '').not.toContain('auth=ey');
  } finally {
    for (const c of contexts) await c.dispose();
    await org.remove();
    await prisma.$disconnect();
  }
});
