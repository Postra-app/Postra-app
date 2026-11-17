process.env.JWT_SECRET = 'test-secret';
process.env.FRONTEND_URL = 'https://app.postra.co.uk';
process.env.NOT_SECURED = '';

import { HttpException } from '@nestjs/common';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';

// A database that refused while a valid session was being checked answered
// 401 and cleared the cookie: a restart or failover of RDS signed every active
// customer out at once. The session is fine;
// the server is not — 503, and the cookie stays.
const run = async (auth: string, getUserById: jest.Mock) => {
  const middleware = new AuthMiddleware(
    { getOrgsByUserId: jest.fn(), updateApiKey: jest.fn() } as any,
    { getUserById, touchLastOnline: jest.fn() } as any
  );
  const req: any = {
    headers: { auth },
    cookies: {},
    path: '/user/self',
    url: '/user/self',
    method: 'GET',
    ip: '203.0.113.7',
  };
  return middleware.use(req, { cookie: jest.fn(), header: jest.fn() } as any, jest.fn()).then(
    (): undefined => undefined,
    (e: unknown) => e
  );
};

describe('session check when the database fails', () => {
  // The shapes Prisma throws when the database does not answer.
  const unreachable = Object.assign(new Error("Can't reach database server"), {
    name: 'PrismaClientInitializationError',
    errorCode: 'P1001',
  });
  const poolDry = Object.assign(new Error('Timed out fetching a new connection from the connection pool'), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2024',
  });

  it.each([
    ['unreachable', unreachable],
    ['pool run dry', poolDry],
  ])('answers 503, not the sign-out answer, when the database is %s', async (_, failure) => {
    const error = await run(
      AuthService.signJWT({ id: 'user-1', tokenVersion: 0 } as any),
      jest.fn().mockRejectedValue(failure)
    );
    expect(error).toBeInstanceOf(HttpException);
    expect(error).not.toBeInstanceOf(HttpForbiddenException);
    expect((error as HttpException).getStatus()).toBe(503);
  });

  // Any other fault stays the sign-out it was: a bug of ours must not leave a
  // customer on "Can't load Postra" for good.
  it('still signs out on an error that is not the database being away', async () => {
    const error = await run(
      AuthService.signJWT({ id: 'user-1', tokenVersion: 0 } as any),
      jest.fn().mockRejectedValue(new TypeError('Cannot read properties of undefined'))
    );
    expect(error).toBeInstanceOf(HttpForbiddenException);
  });

  // Every organisation disabled (seats cut after a downgrade): this went
  // through a TypeError on `setOrg`; it must stay a sign-out, not a 503.
  it('signs out a member whose every organisation is disabled', async () => {
    const middleware = new AuthMiddleware(
      {
        getOrgsByUserId: jest.fn().mockResolvedValue([{ id: 'o1', users: [{ disabled: true }] }]),
        updateApiKey: jest.fn(),
      } as any,
      {
        getUserById: jest.fn().mockResolvedValue({ id: 'user-1', activated: true, tokenVersion: 0 }),
        touchLastOnline: jest.fn(),
      } as any
    );
    const req: any = {
      headers: { auth: AuthService.signJWT({ id: 'user-1', tokenVersion: 0 } as any) },
      cookies: {},
      path: '/user/self',
      url: '/user/self',
      method: 'GET',
      ip: '203.0.113.7',
    };
    const error = await middleware
      .use(req, { cookie: jest.fn(), header: jest.fn() } as any, jest.fn())
      .then((): undefined => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(HttpForbiddenException);
  });

  it('still signs out a token that does not verify', async () => {
    const getUserById = jest.fn().mockRejectedValue(new Error('down'));
    const error = await run('not-a-jwt', getUserById);
    expect(error).toBeInstanceOf(HttpForbiddenException);
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('still signs out a user that no longer exists', async () => {
    const error = await run(
      AuthService.signJWT({ id: 'gone', tokenVersion: 0 } as any),
      jest.fn().mockResolvedValue(null)
    );
    expect(error).toBeInstanceOf(HttpForbiddenException);
  });
});
