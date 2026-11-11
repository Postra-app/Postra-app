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
    mobileJwt: jest.fn((jwt: string) => `mobile:${jwt}`),
  };
  const audit = { record: jest.fn() };
  return {
    ctrl: new AuthController(auth as any, {} as any, audit as any),
    auth,
    audit,
  };
}

describe('POST /auth/google/native', () => {
  it('answers the app token in the body, never the web one, and sets no cookie', async () => {
    const { ctrl, audit } = controller({ jwt: 'web', user: { email: 'g@example.com' } });
    const res = fakeResponse();
    await ctrl.googleNative({ idToken: 't' } as any, res, '1.2.3.4', 'ua');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ login: true, token: 'mobile:web' });
    expect(res.cookie).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login', metadata: expect.objectContaining({ provider: 'GOOGLE', via: 'mobile' }) })
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
