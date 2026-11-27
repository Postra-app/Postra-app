jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { AuthController } from './auth.controller';

function fakeResponse() {
  const res: any = { statusCode: 0, body: undefined as unknown };
  res.status = jest.fn((code: number) => ((res.statusCode = code), res));
  res.type = jest.fn(() => res);
  res.send = jest.fn((b: unknown) => ((res.body = b), res));
  res.json = jest.fn((b: unknown) => ((res.body = b), res));
  res.cookie = jest.fn(() => res);
  return res;
}

function controller(result: any) {
  const auth = {
    googleNativeLogin: jest.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    appleNativeLogin: jest.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    mobileJwt: jest.fn((jwt: string) => `mobile:${jwt}`),
  };
  const audit = { record: jest.fn() };
  return {
    ctrl: new AuthController(auth as any, {} as any, audit as any, {} as any),
    auth,
    audit,
  };
}

describe('POST /auth/google/native', () => {
  it('answers the app token in the body, never the web one, and sets no cookie', async () => {
    const { ctrl, audit } = controller({ jwt: 'web', user: { id: 'user-g', email: 'g@example.com' } });
    const res = fakeResponse();
    await ctrl.googleNative({ idToken: 't' } as any, res, '1.2.3.4', 'ua');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ login: true, token: 'mobile:web' });
    expect(res.cookie).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login', userId: 'user-g', metadata: expect.objectContaining({ provider: 'GOOGLE', via: 'mobile' }) })
    );
  });

  // The app tells "sign up on the web" from "try again" by the status.
  it('answers 404 when no account uses the Google account', async () => {
    const { ctrl, audit } = controller({ error: 'no_account' });
    const res = fakeResponse();
    await ctrl.googleNative({ idToken: 't' } as any, res, 'ip', 'ua');

    expect(res.statusCode).toBe(404);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login.failed' }));
  });

  it('answers 409 when the address has an account with a password', async () => {
    const { ctrl, audit } = controller({ error: 'password_account' });
    const res = fakeResponse();
    await ctrl.googleNative({ idToken: 't' } as any, res, 'ip', 'ua');

    expect(res.statusCode).toBe(409);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login.failed', metadata: expect.objectContaining({ reason: 'password_account' }) })
    );
  });

  it('answers 400 for a token Google did not vouch for', async () => {
    const { ctrl } = controller({ error: 'invalid' });
    const res = fakeResponse();
    await ctrl.googleNative({ idToken: 't' } as any, res, 'ip', 'ua');

    expect(res.statusCode).toBe(400);
    expect(res.body).toBe('Google sign-in failed. Please try again.');
  });

  it('answers 400 with the reason for a suspended account, not a 500', async () => {
    const { ctrl } = controller(new Error('This account is suspended.'));
    const res = fakeResponse();
    await ctrl.googleNative({ idToken: 't' } as any, res, 'ip', 'ua');

    expect(res.statusCode).toBe(400);
    expect(res.body).toBe('This account is suspended.');
  });
});

describe('POST /auth/google/native and /auth/apple/native with a sign-up', () => {
  it('passes the sign-up on only when the app asks for an account', async () => {
    const { ctrl, auth } = controller({ jwt: 'web', user: { id: 'u' }, created: false });
    await ctrl.googleNative({ idToken: 't' } as any, fakeResponse(), 'ip', 'ua');
    expect(auth.googleNativeLogin).toHaveBeenLastCalledWith('t', undefined);

    await ctrl.googleNative(
      { idToken: 't', create: true, company: '  Studio  ', termsAccepted: true, platform: 'ios' } as any,
      fakeResponse(),
      'ip',
      'ua'
    );
    expect(auth.googleNativeLogin).toHaveBeenLastCalledWith('t', {
      company: 'Studio',
      platform: 'ios',
      ip: 'ip',
      userAgent: 'ua',
    });
  });

  it('records a new account as a registration and says so to the app', async () => {
    const { ctrl, audit } = controller({ jwt: 'web', user: { id: 'user-new' }, created: true });
    const res = fakeResponse();
    await ctrl.appleNative(
      { identityToken: 't', nonce: 'n', create: true, company: 'K', termsAccepted: true } as any,
      res,
      'ip',
      'ua'
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ login: true, created: true, token: 'mobile:web' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.register', userId: 'user-new', metadata: { provider: 'APPLE', via: 'mobile' } })
    );
  });

  it('answers 409 naming the provider the address already signs in with', async () => {
    const { ctrl } = controller({ error: 'other_account', provider: 'GOOGLE' });
    const res = fakeResponse();
    await ctrl.appleNative({ identityToken: 't', nonce: 'n' } as any, res, 'ip', 'ua');

    expect(res.statusCode).toBe(409);
    expect(res.body).toBe('This email has a Postra account that signs in with Google.');
  });

  it('answers 403 while sign-ups are closed', async () => {
    const { ctrl } = controller({ error: 'closed' });
    const res = fakeResponse();
    await ctrl.appleNative({ identityToken: 't', nonce: 'n' } as any, res, 'ip', 'ua');

    expect(res.statusCode).toBe(403);
  });

  it('names Apple when its sign-in fails', async () => {
    const { ctrl } = controller({ error: 'invalid' });
    const res = fakeResponse();
    await ctrl.appleNative({ identityToken: 't', nonce: 'n' } as any, res, 'ip', 'ua');

    expect(res.statusCode).toBe(400);
    expect(res.body).toBe('Apple sign-in failed. Please try again.');
  });
});
