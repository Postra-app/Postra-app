jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendActivationMail } = require('./auth.service');

// Sign-in mails go out directly, never through the Temporal mail queue: with
// the queue down registration failed (E2E-02-04), with its workflow stuck the
// queue still took signals and nothing left, and the reset mail vanished
// without a log (upstream 1f5f24e5).
describe('activation mail', () => {
  it('is sent directly', async () => {
    const e = { sendEmail: jest.fn(), sendEmailSync: jest.fn().mockResolvedValue(undefined) };
    await sendActivationMail(e, 'a@b.co', 'Activate', '<p>x</p>');
    expect(e.sendEmailSync).toHaveBeenCalledWith('a@b.co', 'Activate', '<p>x</p>');
    expect(e.sendEmail).not.toHaveBeenCalled();
  });
});

// 2.2.3: "forgot password" must not wait for the mail, or a known address
// answers slower than an unknown one.
describe('forgot password', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AuthService } = require('./auth.service');
  it('answers without waiting for the mail', async () => {
    const service = Object.create(AuthService.prototype);
    const never = new Promise(() => undefined);
    Object.assign(service, {
      _userService: { getUserByEmail: async () => ({ id: 'u1', email: 'a@b.co', providerName: 'LOCAL', tokenVersion: 1 }) },
      _emailService: { sendEmailSync: jest.fn(() => never) },
    });
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    const done = await Promise.race([
      service.forgot('a@b.co').then(() => 'answered'),
      new Promise((r) => setTimeout(() => r('waited for the mail'), 500)),
    ]);
    expect(done).toBe('answered');
    expect(service._emailService.sendEmailSync).toHaveBeenCalledTimes(1);
  });
});

describe('password reset mail', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AuthService } = require('./auth.service');
  it('is sent directly, not through the mail queue', async () => {
    const service = Object.create(AuthService.prototype);
    const sendEmailSync = jest.fn().mockResolvedValue(undefined);
    const queue = jest.fn().mockResolvedValue(undefined);
    Object.assign(service, {
      _userService: { getUserByEmail: async () => ({ id: 'u1', email: 'a@b.co', providerName: 'LOCAL', tokenVersion: 1 }) },
      _emailService: { sendEmailSync },
      _notificationService: { sendEmail: queue },
    });
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    await service.forgot('a@b.co');
    await new Promise((r) => setImmediate(r));
    expect(sendEmailSync).toHaveBeenCalledWith('a@b.co', expect.any(String), expect.stringContaining('/auth/forgot/'));
    expect(queue).not.toHaveBeenCalled();
  });
});


// K. 2026-10-18: "this is not a banking app". A password found in a public
// breach list used to be refused at sign-up and reset, which put people off;
// the minimum length (8, in the DTOs) is the rule now.
describe('password policy', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AuthService } = require('./auth.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AuthChecker = require('@gitroom/helpers/auth/auth.service').AuthService;
  it('a reset takes a password that appears in breach lists, without asking HIBP', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const service = Object.create(AuthService.prototype);
    const updatePassword = jest.fn().mockResolvedValue(true);
    Object.assign(service, {
      _userService: { getUserById: async () => ({ id: 'u1', tokenVersion: 1 }), updatePassword },
    });
    const token = AuthChecker.signJWT({ id: 'u1', tokenVersion: 1, expires: new Date(Date.now() + 600_000).toISOString() });

    await expect(service.forgotReturn({ token, password: 'password123', repeatPassword: 'password123' })).resolves.toBe(true);
    expect(updatePassword).toHaveBeenCalledWith('u1', 'password123', 1);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('pwnedpasswords'))).toBe(false);
    fetchSpy.mockRestore();
  });
});
