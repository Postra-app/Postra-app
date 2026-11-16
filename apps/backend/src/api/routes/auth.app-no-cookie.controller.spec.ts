jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { AuthController } from './auth.controller';

// The app's session is the short token in its Keychain. A web cookie handed
// to it as well lived for 30 days in the phone's cookie store, where the
// app's sign-out never reached it.

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

function controller(addedOrg: any = false) {
  const auth = {
    getOrgFromCookie: jest.fn(() => false),
    routeAuth: jest.fn(async () => ({ jwt: 'web', addedOrg, userId: 'u1' })),
    mobileJwt: jest.fn((jwt: string) => `mobile:${jwt}`),
  };
  const email = { hasProvider: jest.fn(() => false) };
  const audit = { record: jest.fn() };
  return new AuthController(auth as any, email as any, audit as any);
}

const request = (client?: string) =>
  ({ headers: client ? { 'x-client': client } : {}, cookies: {} } as any);

const liveCookies = (res: any) =>
  res.cookie.mock.calls.filter(([, value]: [string, string]) => value !== '');

describe('session cookie at sign-in', () => {
  const body = { provider: 'LOCAL', email: 'a@example.com', password: 'x' } as any;

  it('gives the browser its cookie', async () => {
    const res = fakeResponse();
    await controller().login(request(), body, res, 'ip', 'ua');

    expect(res.body).toEqual({ login: true });
    expect(liveCookies(res)).toEqual([['auth', 'web', expect.anything()]]);
  });

  it('gives the app its token in the body and no cookie', async () => {
    const res = fakeResponse();
    await controller({ organizationId: 'org1' }).login(request('mobile'), body, res, 'ip', 'ua');

    expect(res.body).toEqual({ login: true, token: 'mobile:web', org: 'org1' });
    expect(liveCookies(res)).toEqual([]);
  });

  it('expires the cookies an older version of the app was given', async () => {
    const res = fakeResponse();
    await controller().login(request('mobile'), body, res, 'ip', 'ua');

    const expired = res.cookie.mock.calls
      .filter(([, value, options]: [string, string, any]) => value === '' && options.expires <= new Date())
      .map(([name]: [string]) => name);
    expect(expired).toEqual(expect.arrayContaining(['auth', 'showorg']));
  });

  it('does the same when the app signs up', async () => {
    const res = fakeResponse();
    await controller().register(request('mobile'), body, res, 'ip', 'ua');

    expect(res.body).toEqual({ register: true, token: 'mobile:web', org: undefined });
    expect(liveCookies(res)).toEqual([]);
  });
});

describe('activation link that fails', () => {
  it('answers the one sentence the page shows, never the error behind it', async () => {
    const auth = {
      activate: jest.fn(async () => {
        throw new Error('Can\'t reach database server at `db.internal:5432`');
      }),
    };
    const res = fakeResponse();
    await new AuthController(auth as any, {} as any, { record: jest.fn() } as any).activate(
      { cookies: {}, headers: {} } as any,
      'code',
      '',
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('db.internal');
    expect(res.body).toMatch(/invalid or (has )?expired/i);
  });
});
