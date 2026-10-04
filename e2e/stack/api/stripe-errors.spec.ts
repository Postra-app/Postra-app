import { expect, test } from '@playwright/test';
import { signedIn } from '../helpers';

// Stripe refusing our own key (the stack's key is a placeholder, so every
// Stripe call does) reached the browser as Stripe's 401 and its message —
// and the app treats 401 as an ended session, signing the customer out on
// the paywall. It is our failure: 502, nothing of Stripe's, session intact.
test('a Stripe failure on our side is a 502 that keeps the session', async () => {
  const b = await signedIn('b');
  const res = await b.post('/billing/embedded', { data: { period: 'MONTHLY', billing: 'PRO' } });
  expect(res.status()).toBe(502);
  const body = await res.text();
  expect(body).toContain('Payments are unavailable right now');
  expect(body).not.toMatch(/sk_|API Key/i);
  expect((await b.get('/user/self')).status()).toBe(200);
  await b.dispose();
});
