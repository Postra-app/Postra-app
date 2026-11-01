process.env.JWT_SECRET = 'test-secret';
process.env.FRONTEND_URL = 'https://app.postra.co.uk';
process.env.NOT_SECURED = '';

import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

// Upstream a5affe62c ("jwt bypass"): every signed token shares JWT_SECRET,
// and a token whose `id` is not a string (an object, which Prisma reads as a
// filter) must never reach the user lookup.
describe('session token payload', () => {
  it('a token whose id is not a string is refused before any lookup', async () => {
    const getUserById = jest.fn();
    const middleware = new AuthMiddleware(
      { getOrgsByUserId: jest.fn(), updateApiKey: jest.fn() } as any,
      { getUserById, touchLastOnline: jest.fn() } as any
    );
    const req: any = {
      headers: { auth: AuthService.signJWT({ id: { not: '' } }) },
      cookies: {},
      path: '/integrations/list',
      url: '/integrations/list',
      ip: '203.0.113.7',
    };
    await expect(
      middleware.use(req, { cookie: jest.fn(), header: jest.fn() } as any, jest.fn())
    ).rejects.toBeTruthy();
    expect(getUserById).not.toHaveBeenCalled();
  });
});

describe('UsersRepository.getUserById', () => {
  it('looks nothing up for an id that is not a string', async () => {
    const { UsersRepository } = await import(
      '@gitroom/nestjs-libraries/database/prisma/users/users.repository'
    );
    const findFirst = jest.fn();
    const repo = new (UsersRepository as any)({ model: { user: { findFirst } } }, {}, {});
    expect(await repo.getUserById({ not: '' } as any)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
