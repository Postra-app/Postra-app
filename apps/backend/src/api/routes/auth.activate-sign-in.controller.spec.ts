jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { ACTIVATION_WRONG_PASSWORD } from '@gitroom/backend/services/auth/auth.service';
import { AuthController } from './auth.controller';

// The activation link opened in a browser other than the one that signed up:
// the page asks for the sign-up password, which activates and signs in, or
// offers a new password. Opening the link alone signs nobody in.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

function fakeResponse() {
  const res: any = { statusCode: 0, body: undefined as unknown };
  res.status = jest.fn((code: number) => ((res.statusCode = code), res));
  res.type = jest.fn(() => res);
  res.send = jest.fn((b: unknown) => ((res.body = b), res));
  res.json = jest.fn((b: unknown) => ((res.body = b), res));
  res.header = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  return res;
}

const liveCookies = (res: any) =>
  res.cookie.mock.calls
    .filter(([, value]: [string, string]) => value !== '')
    .map(([name]: [string]) => name);

const build = (auth: Record<string, unknown>) => {
  const audit = { record: jest.fn() };
  return {
    audit,
    c: new AuthController(auth as any, {} as any, audit as any, {} as any),
  };
};

describe('activation link opened in another browser', () => {
  it('opening it gives no session and asks to sign in', async () => {
    const { c } = build({
      activate: jest.fn(async () => ({ signIn: 'a@example.com' })),
    });
    const res = fakeResponse();
    await c.activate({ cookies: {}, headers: {} } as any, 'code', '', res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ can: true, signIn: true, email: 'a@example.com' });
    expect(liveCookies(res)).not.toContain('auth');
  });

  it('the sign-up password signs this browser in', async () => {
    const jwt = AuthChecker.signJWT({ id: 'u1', email: 'a@example.com' });
    const auth = { activateWithPassword: jest.fn(async () => jwt) };
    const { c, audit } = build(auth);
    const res = fakeResponse();
    await c.activateSignIn('code', 'Owner-pass-1', '', res, '1.2.3.4', 'ua');
    expect(auth.activateWithPassword).toHaveBeenCalledWith('code', 'Owner-pass-1', '');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ can: true });
    expect(liveCookies(res)).toContain('auth');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login', userId: 'u1' })
    );
  });

  it('a wrong password gives no session and the sentence the page shows', async () => {
    const { c, audit } = build({
      activateWithPassword: jest.fn(async () => {
        throw new Error(ACTIVATION_WRONG_PASSWORD);
      }),
    });
    const res = fakeResponse();
    await c.activateSignIn('code', 'guess', '', res, '1.2.3.4', 'ua');
    expect(res.statusCode).toBe(400);
    expect(res.body).toBe(ACTIVATION_WRONG_PASSWORD);
    expect(liveCookies(res)).not.toContain('auth');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login.failed' })
    );
  });

  it('the sign-in lockout answers 429', async () => {
    const { c } = build({
      activateWithPassword: jest.fn(async () => {
        throw new Error(
          'Too many failed login attempts. Please try again in a few minutes.'
        );
      }),
    });
    const res = fakeResponse();
    await c.activateSignIn('code', 'x', '', res, '1.2.3.4', 'ua');
    expect(res.statusCode).toBe(429);
  });

  it('a database error is not shown to whoever opened the link', async () => {
    const { c } = build({
      activateWithPassword: jest.fn(async () => {
        throw new Error("Can't reach database server at `db.internal:5432`");
      }),
    });
    const res = fakeResponse();
    await c.activateSignIn('code', 'x', '', res, '1.2.3.4', 'ua');
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('db.internal');
  });

  it('choosing a new password gives the token for it and no session', async () => {
    const { c } = build({
      activateAndChoosePassword: jest.fn(async () => ({ setPassword: 'reset-token' })),
    });
    const res = fakeResponse();
    await c.activateReset('code', '', res);
    expect(res.body).toEqual({ can: true, setPassword: 'reset-token' });
    expect(liveCookies(res)).not.toContain('auth');
  });
});
