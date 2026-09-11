import { censusSecrets } from '@gitroom/nestjs-libraries/services/redact.secrets';

/**
 * The scrub report said "111 row(s) scanned, 111 still carrying credentials"
 * on production, where the plaintext exposure was about half of that. The rest
 * were tokens encrypted at rest, which redaction covers for tidiness and which
 * are not a leak. An operator acts on the number they read, so the two have to
 * be counted separately.
 */
describe('censusSecrets', () => {
  it('counts a plaintext token as plaintext', () => {
    const body = JSON.stringify({
      integration: { token: 'IGAAxxxxxxxxxxxxxxxxxxxx', name: 'insta' },
    });
    expect(censusSecrets(body)).toEqual({ plaintext: 1, encrypted: 0 });
  });

  it('does not count an encrypted token as a leak', () => {
    const body = JSON.stringify({
      integration: { token: 'enc::a1b2c3d4e5f6', refreshToken: 'enc::998877' },
    });
    expect(censusSecrets(body)).toEqual({ plaintext: 0, encrypted: 2 });
  });

  it('reports a row holding one of each', () => {
    const body = JSON.stringify({
      posts: [
        { integration: { token: 'plain-one', refreshToken: 'enc::sealed' } },
      ],
    });
    expect(censusSecrets(body)).toEqual({ plaintext: 1, encrypted: 1 });
  });

  it('ignores a secret-named field that holds nothing', () => {
    const body = JSON.stringify({ token: null, refreshToken: '' });
    expect(censusSecrets(body)).toEqual({ plaintext: 0, encrypted: 0 });
  });

  it('finds tokens however the key is spelled', () => {
    const body = JSON.stringify({
      access_token: 'one',
      'REFRESH-TOKEN': 'two',
      clientSecret: 'three',
    });
    expect(censusSecrets(body).plaintext).toBe(3);
  });

  it('counts nothing in a body that is not JSON', () => {
    expect(censusSecrets('Attachment exceeds Discord size limit')).toEqual({
      plaintext: 0,
      encrypted: 0,
    });
  });

  it('counts nothing in an empty body', () => {
    expect(censusSecrets(null)).toEqual({ plaintext: 0, encrypted: 0 });
    expect(censusSecrets(undefined)).toEqual({ plaintext: 0, encrypted: 0 });
  });

  it('survives a deeply nested payload without double counting', () => {
    const body = JSON.stringify({
      a: { b: { c: { d: { token: 'deep' } } } },
      e: [{ token: 'enc::x' }, { token: 'enc::y' }],
    });
    expect(censusSecrets(body)).toEqual({ plaintext: 1, encrypted: 2 });
  });
});
