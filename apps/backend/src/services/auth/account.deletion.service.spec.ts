const redisSet = jest.fn();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: (...a: unknown[]) => redisSet(...a) },
}));
const bust = jest.fn();
jest.mock('@gitroom/nestjs-libraries/redis/auth-context.cache', () => ({
  bustAuthContextCache: (...a: unknown[]) => bust(...a),
}));

import { Provider } from '@prisma/client';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import {
  AccountDeletionService,
  DELETE_ACCOUNT_PURPOSE,
  DELETE_MAIL_NOT_SENT,
  WRONG_PASSWORD,
} from './account.deletion.service';

process.env.JWT_SECRET = 'test-secret-for-account-deletion';
process.env.FRONTEND_URL = 'https://app.example.test';

const PASSWORD = 'correct horse battery staple';
const hash = AuthChecker.hashPassword(PASSWORD);

function setup(user: Record<string, unknown> | null, sent = true) {
  const calls: string[] = [];
  const users = {
    getUserById: jest.fn(async () => user),
    getSoleOwnedOrganizations: jest.fn(async () => ['org-1']),
    deleteAccount: jest.fn(async () => {
      calls.push('deleteAccount');
    }),
  };
  const stripe = {
    cancelAllSubscriptionsForDeletedAccount: jest.fn(async () => {
      calls.push('stripe');
    }),
  };
  const notifications = { sendEmail: jest.fn(async (..._a: unknown[]): Promise<void> => undefined) };
  const email = { sendEmailSync: jest.fn(async (..._a: unknown[]) => sent) };
  const service = new AccountDeletionService(
    users as any,
    stripe as any,
    notifications as any,
    email as any
  );
  return { service, users, stripe, notifications, email, calls };
}

const local = {
  id: 'user-1',
  email: 'owner@example.com',
  providerName: Provider.LOCAL,
  password: hash,
  tokenVersion: 3,
};
const google = { ...local, providerName: Provider.GOOGLE };

function linkToken(sendEmailSync: jest.Mock) {
  const html = sendEmailSync.mock.calls[0][2] as string;
  const m = html.match(/\/auth\/delete-account\/([A-Za-z0-9._-]+)/);
  return m![1];
}

beforeEach(() => {
  redisSet.mockReset().mockResolvedValue('OK');
  bust.mockReset();
});

describe('AccountDeletionService.request', () => {
  it('a session without a password deletes nothing and emails a link', async () => {
    const { service, users, stripe, email } = setup(local);
    await expect(service.request('user-1', undefined)).resolves.toEqual({
      confirm: 'email',
    });
    expect(users.deleteAccount).not.toHaveBeenCalled();
    expect(stripe.cancelAllSubscriptionsForDeletedAccount).not.toHaveBeenCalled();
    expect(email.sendEmailSync).toHaveBeenCalledTimes(1);
    expect(email.sendEmailSync.mock.calls[0][0]).toBe('owner@example.com');
    const claims = AuthChecker.verifyJWT(linkToken(email.sendEmailSync)) as any;
    expect(claims).toMatchObject({
      id: 'user-1',
      tokenVersion: 3,
      purpose: DELETE_ACCOUNT_PURPOSE,
    });
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it('the right password deletes now, Stripe before the rows', async () => {
    const { service, users, calls, notifications } = setup(local);
    await expect(service.request('user-1', PASSWORD)).resolves.toEqual({
      deleted: true,
    });
    expect(calls).toEqual(['stripe', 'deleteAccount']);
    expect(users.deleteAccount).toHaveBeenCalledWith('user-1');
    expect(bust).toHaveBeenCalledWith('user-1');
    expect(notifications.sendEmail).toHaveBeenCalledWith(
      'owner@example.com',
      'Your Postra account has been deleted',
      expect.any(String)
    );
  });

  it('a wrong password is a 400 and deletes nothing', async () => {
    const { service, users, email } = setup(local);
    await expect(service.request('user-1', 'guess')).rejects.toMatchObject({
      message: WRONG_PASSWORD,
      status: 400,
    });
    expect(users.deleteAccount).not.toHaveBeenCalled();
    expect(email.sendEmailSync).not.toHaveBeenCalled();
  });

  it('a Google account gets the email even when a password is sent', async () => {
    const { service, users, email } = setup(google);
    await expect(service.request('user-1', PASSWORD)).resolves.toEqual({
      confirm: 'email',
    });
    expect(users.deleteAccount).not.toHaveBeenCalled();
    expect(email.sendEmailSync).toHaveBeenCalledTimes(1);
  });

  it('a mail that could not be sent is an error, not a 202', async () => {
    const { service } = setup(local, false);
    await expect(service.request('user-1', undefined)).rejects.toMatchObject({
      message: DELETE_MAIL_NOT_SENT,
      status: 503,
    });
  });
});

describe('AccountDeletionService.confirm', () => {
  async function mintedLink() {
    const s = setup(local);
    await s.service.request('user-1', undefined);
    return linkToken(s.email.sendEmailSync);
  }

  it('the emailed link deletes the account', async () => {
    const token = await mintedLink();
    const { service, users, calls } = setup(local);
    await expect(service.confirm(token)).resolves.toBe('user-1');
    expect(calls).toEqual(['stripe', 'deleteAccount']);
    expect(users.deleteAccount).toHaveBeenCalledWith('user-1');
  });

  it('dies when the account changed its password (tokenVersion moved on)', async () => {
    const token = await mintedLink();
    const { service, users } = setup({ ...local, tokenVersion: 4 });
    await expect(service.confirm(token)).resolves.toBeNull();
    expect(users.deleteAccount).not.toHaveBeenCalled();
  });

  it('does nothing for an account already gone', async () => {
    const token = await mintedLink();
    const { service, users } = setup(null);
    await expect(service.confirm(token)).resolves.toBeNull();
    expect(users.deleteAccount).not.toHaveBeenCalled();
  });

  it('a session or reset token is not a deletion link', async () => {
    const session = AuthChecker.signJWT({ id: 'user-1', tokenVersion: 3 });
    const reset = AuthChecker.signJWT({
      id: 'user-1',
      tokenVersion: 3,
      purpose: 'reset',
      expires: '2099-01-01 00:00:00',
    });
    const { service, users } = setup(local);
    await expect(service.confirm(session)).resolves.toBeNull();
    await expect(service.confirm(reset)).resolves.toBeNull();
    await expect(service.confirm(session + 'x')).resolves.toBeNull();
    await expect(service.confirm({ id: 'user-1' })).resolves.toBeNull();
    expect(users.deleteAccount).not.toHaveBeenCalled();
  });

  it('an expired link deletes nothing', async () => {
    const expired = AuthChecker.signJWT(
      { id: 'user-1', tokenVersion: 3, purpose: DELETE_ACCOUNT_PURPOSE },
      { expiresIn: -10 }
    );
    const { service, users } = setup(local);
    await expect(service.confirm(expired)).resolves.toBeNull();
    expect(users.deleteAccount).not.toHaveBeenCalled();
  });

  it('two clicks at once delete once', async () => {
    const token = await mintedLink();
    const { service, users } = setup(local);
    redisSet.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const [a, b] = await Promise.all([
      service.confirm(token),
      service.confirm(token),
    ]);
    expect([a, b].filter(Boolean)).toEqual(['user-1']);
    expect(users.deleteAccount).toHaveBeenCalledTimes(1);
  });
});
