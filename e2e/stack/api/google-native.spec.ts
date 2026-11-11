import { expect, request as pwRequest, test } from '@playwright/test';
import { BACKEND_URL } from '../helpers';

// The mobile app's Google sign-in. A real Google ID token cannot
// be minted here (the signature check is covered with a local key in
// google.id-token.spec.ts); this proves the route is public, validates its
// body and never signs anyone in or sets a cookie for a token Google did not
// sign.
test('Google sign-in from the app refuses anything Google did not sign', async () => {
  const phone = await pwRequest.newContext({
    baseURL: BACKEND_URL,
    extraHTTPHeaders: {
      'x-client': 'mobile',
      'x-forwarded-for': `198.21.${Math.floor(Math.random() * 250)}.9`,
    },
  });
  try {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'x' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: '1', email: 'a@b.c', email_verified: true })).toString('base64url');
    const forged = await phone.post('/auth/google/native', { data: { idToken: `${head}.${body}.c2ln` } });
    expect(forged.status()).toBe(400);
    expect(await forged.text()).toBe('Google sign-in failed. Please try again.');
    expect(forged.headers()['set-cookie']).toBeUndefined();

    expect((await phone.post('/auth/google/native', { data: {} })).status()).toBe(400);
    expect((await phone.post('/auth/google/native', { data: { idToken: 'x'.repeat(5000) } })).status()).toBe(400);
  } finally {
    await phone.dispose();
  }
});
