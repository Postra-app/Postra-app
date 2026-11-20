jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { AuthController } from './auth.controller';

// A new account's audit showed no sign-up and no sign-in. The sign-up row
// carried only the address (no user, no organisation), and the activation
// link opened in the browser that signed up signed the user in with no row
// at all. Both rows now name the account.

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

const build = (auth: Record<string, unknown>, emailProvider = true) => {
  const audit = { record: jest.fn() };
  const email = { hasProvider: jest.fn(() => emailProvider) };
  return {
    audit,
    c: new AuthController(auth as any, email as any, audit as any, {} as any),
  };
};

describe('audit trail of a new account', () => {
  const body = { provider: 'LOCAL', email: 'a@example.com', password: 'x' } as any;

  it('the sign-up row names the user and the organisation', async () => {
    const { c, audit } = build({
      getOrgFromCookie: jest.fn(() => false),
      routeAuth: jest.fn(async () => ({
        jwt: 'web',
        addedOrg: false,
        userId: 'u1',
        organizationId: 'o1',
        registrationProof: 'proof',
      })),
    });
    const res = fakeResponse();
    await c.register({ headers: {}, cookies: {} } as any, body, res, '1.2.3.4', 'ua');
    expect(res.body).toEqual({ activate: true });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.register',
        userId: 'u1',
        organizationId: 'o1',
      })
    );
  });

  it('the activation link in the browser that signed up records the sign-in', async () => {
    const jwt = AuthChecker.signJWT({ id: 'u1', email: 'a@example.com' });
    const { c, audit } = build({ activate: jest.fn(async () => jwt) });
    const res = fakeResponse();
    await (c.activate as any)(
      { cookies: { postra_reg: 'proof' }, headers: {} },
      'code',
      '',
      res,
      '1.2.3.4',
      'ua'
    );
    expect(res.body).toEqual({ can: true });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login',
        userId: 'u1',
        ip: '1.2.3.4',
        metadata: expect.objectContaining({ via: 'activation-link' }),
      })
    );
  });

  it('a browser that keeps its own session records no sign-in', async () => {
    const jwt = AuthChecker.signJWT({ id: 'u1', email: 'a@example.com' });
    const { c, audit } = build({ activate: jest.fn(async () => jwt) });
    const res = fakeResponse();
    await (c.activate as any)(
      { cookies: { auth: 'someone-else' }, headers: {} },
      'code',
      '',
      res,
      '1.2.3.4',
      'ua'
    );
    expect(res.body).toEqual({ can: true, kept: true });
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login' })
    );
  });
});
