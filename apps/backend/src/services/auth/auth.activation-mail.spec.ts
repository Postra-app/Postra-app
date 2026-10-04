jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendActivationMail } = require('./auth.service');

// E2E-02-04: with Temporal down, registration answered 400 for an account it
// had already created, and the activation mail never went out.
describe('activation mail', () => {
  const emails = (queue: () => Promise<unknown>) => ({
    sendEmail: jest.fn(queue),
    sendEmailSync: jest.fn().mockResolvedValue(undefined),
  });

  it('goes through the queue when the queue takes it', async () => {
    const e = emails(async () => ({ workflowId: 'send_email' }));
    await sendActivationMail(e, 'a@b.co', 'Activate', '<p>x</p>');
    expect(e.sendEmailSync).not.toHaveBeenCalled();
  });

  it('is sent directly when the queue refuses it', async () => {
    const e = emails(async () => {
      throw new Error('Failed to signalWithStart Workflow');
    });
    await expect(sendActivationMail(e, 'a@b.co', 'Activate', '<p>x</p>')).resolves.toBeUndefined();
    expect(e.sendEmailSync).toHaveBeenCalledWith('a@b.co', 'Activate', '<p>x</p>');
  });

  it('is sent directly when there is no queue at all', async () => {
    const e = emails(async () => undefined);
    await sendActivationMail(e, 'a@b.co', 'Activate', '<p>x</p>');
    expect(e.sendEmailSync).toHaveBeenCalledTimes(1);
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
      _notificationService: { sendEmail: jest.fn(() => never) },
    });
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    const done = await Promise.race([
      service.forgot('a@b.co').then(() => 'answered'),
      new Promise((r) => setTimeout(() => r('waited for the mail'), 500)),
    ]);
    expect(done).toBe('answered');
    expect(service._notificationService.sendEmail).toHaveBeenCalledTimes(1);
  });
});
