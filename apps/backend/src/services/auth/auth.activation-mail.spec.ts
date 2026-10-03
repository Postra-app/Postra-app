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
