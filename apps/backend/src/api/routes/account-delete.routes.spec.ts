jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: jest.fn(async () => 'OK') },
}));
jest.mock('@gitroom/nestjs-libraries/redis/auth-context.cache', () => ({
  bustAuthContextCache: jest.fn(),
}));

import { Provider } from '@prisma/client';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { AccountDeletionService } from '@gitroom/backend/services/auth/account.deletion.service';
import { AuthController } from './auth.controller';

// Required as in the other users.controller specs: the module graph behind it
// is heavy, and the routes need only the prototype.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UsersController } = require('./users.controller');

process.env.JWT_SECRET = 'test-secret-for-account-delete-routes';
process.env.FRONTEND_URL = 'https://app.example.test';

const PASSWORD = 'correct horse battery staple';

function response() {
  const res: any = { statusCode: 200, headers: {} as Record<string, string> };
  res.status = jest.fn((c: number) => ((res.statusCode = c), res));
  res.header = jest.fn((k: string, v: string) => ((res.headers[k] = v), res));
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  return res;
}

function wiring() {
  const user = {
    id: 'user-1',
    email: 'owner@example.com',
    providerName: Provider.LOCAL,
    password: AuthChecker.hashPassword(PASSWORD),
    tokenVersion: 0,
  };
  const users = {
    getUserById: jest.fn(async () => user),
    getSoleOwnedOrganizations: jest.fn(async (): Promise<string[]> => []),
    deleteAccount: jest.fn(
      async (_id: string, _version?: number): Promise<void> => undefined
    ),
  };
  const email = { sendEmailSync: jest.fn(async (..._a: unknown[]) => true) };
  const deletion = new AccountDeletionService(
    users as any,
    { cancelAllSubscriptionsForDeletedAccount: jest.fn() } as any,
    { sendEmail: jest.fn() } as any,
    email as any
  );
  const usersController = Object.create(UsersController.prototype);
  Object.assign(usersController, {
    _accountDeletion: deletion,
    _userService: users,
    _stripeService: { cancelAllSubscriptionsForDeletedAccount: jest.fn() },
    _notificationService: { sendEmail: jest.fn() },
  });
  const authController = new AuthController(
    {} as any,
    {} as any,
    { record: jest.fn() } as any,
    deletion
  );
  return { users, email, usersController, authController };
}

const req = (cookies: Record<string, string> = {}) =>
  ({ cookies, headers: {} } as any);

describe('POST /user/delete', () => {
  it('a bare session (the store apps: no body) deletes nothing: 202 and an email', async () => {
    const { users, email, usersController } = wiring();
    const res = response();
    const out = await usersController.deleteSelf(
      { id: 'user-1' },
      req(),
      undefined,
      res
    );
    expect(users.deleteAccount).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(202);
    expect(out).toEqual({ confirm: 'email' });
    expect(email.sendEmailSync).toHaveBeenCalledTimes(1);
    expect(res.headers.logout).toBeUndefined();
  });

  it('with the password it deletes and signs the browser out', async () => {
    const { users, usersController } = wiring();
    const res = response();
    const out = await usersController.deleteSelf(
      { id: 'user-1' },
      req(),
      PASSWORD,
      res
    );
    expect(users.deleteAccount).toHaveBeenCalledWith('user-1', expect.any(Number));
    expect(res.statusCode).toBe(200);
    expect(out).toEqual({ deleted: true });
    expect(res.headers.logout).toBe('true');
  });
});

describe('POST /auth/delete-account', () => {
  async function emailedToken(w: ReturnType<typeof wiring>) {
    await w.usersController.deleteSelf({ id: 'user-1' }, req(), undefined, response());
    const html = w.email.sendEmailSync.mock.calls[0][2] as string;
    return html.match(/\/auth\/delete-account\/([A-Za-z0-9._-]+)/)![1];
  }

  it('deletes with the emailed link, and leaves another account\'s browser signed in', async () => {
    const w = wiring();
    const token = await emailedToken(w);
    const someoneElse = AuthChecker.signJWT({ id: 'user-2', tokenVersion: 0 });
    const res = response();
    await expect(
      w.authController.deleteAccount(req({ auth: someoneElse }), token, res)
    ).resolves.toEqual({ deleted: true });
    expect(w.users.deleteAccount).toHaveBeenCalledWith('user-1', expect.any(Number));
    expect(res.headers.logout).toBeUndefined();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('signs out the deleted account\'s own browser', async () => {
    const w = wiring();
    const token = await emailedToken(w);
    const own = AuthChecker.signJWT({ id: 'user-1', tokenVersion: 0 });
    const res = response();
    await w.authController.deleteAccount(req({ auth: own }), token, res);
    expect(res.headers.logout).toBe('true');
  });

  it('a session token is not a link: 400, nothing deleted', async () => {
    const w = wiring();
    const session = AuthChecker.signJWT({ id: 'user-1', tokenVersion: 0 });
    await expect(
      w.authController.deleteAccount(req(), session, response())
    ).rejects.toMatchObject({ status: 400 });
    expect(w.users.deleteAccount).not.toHaveBeenCalled();
  });
});
