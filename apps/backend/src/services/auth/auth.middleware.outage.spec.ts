process.env.JWT_SECRET = 'test-secret';
process.env.FRONTEND_URL = 'https://app.postra.co.uk';
process.env.NOT_SECURED = '';

import { HttpException } from '@nestjs/common';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';

// A database that refused while a valid session was being checked answered
// 401 and cleared the cookie: a restart or failover of RDS signed every active
// customer out at once (frontend review 17 XI, FG-H-1). The session is fine;
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
    () => undefined,
    (e) => e
  );
};

describe('session check when the database fails', () => {
  it('answers 503, not the sign-out answer, when the user lookup throws', async () => {
    const error = await run(
      AuthService.signJWT({ id: 'user-1', tokenVersion: 0 } as any),
      jest.fn().mockRejectedValue(new Error("Can't reach database server"))
    );
    expect(error).toBeInstanceOf(HttpException);
    expect(error).not.toBeInstanceOf(HttpForbiddenException);
    expect((error as HttpException).getStatus()).toBe(503);
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
