import { NotificationService } from './notification.service';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';

// What a notification says comes from outside: the name of a channel is
// whatever its owner called it on the platform, an error is whatever the
// platform answered. In the mail to every member it is text, not markup.

const HOSTILE_NAME = '<a href="//evil.example">Session expired, sign in</a>';

describe('notification mail', () => {
  function service() {
    const sent: Array<{ to: string; subject: string; html: string }> = [];
    const email = {
      sendEmail: jest.fn(async (to: string, subject: string, html: string) => {
        sent.push({ to, subject, html });
      }),
    };
    const orgs = {
      getAllUsersOrgs: jest.fn(async () => ({
        users: [{ user: { email: 'owner@example.com', sendSuccessEmails: true, sendFailureEmails: true } }],
      })),
    };
    const signalWithStart = jest.fn(async () => undefined);
    const temporal = { client: { getRawClient: () => ({ workflow: { signalWithStart } }) } };
    const push = { notifyOrg: jest.fn().mockResolvedValue(undefined) };
    const repo = { createNotification: jest.fn().mockResolvedValue(undefined) };
    const s = new NotificationService(repo as any, email as any, orgs as any, temporal as any, push as any);
    return { s, sent, signalWithStart, push, repo };
  }

  it('carries a channel name as text', async () => {
    const { s, sent } = service();
    await s.inAppNotification('org1', 'Could not post', `Channel ${HOSTILE_NAME} was disconnected`, true, false, 'fail');

    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain('<a');
    expect(sent[0].html).toContain('&lt;a href=&quot;//evil.example&quot;&gt;');
  });

  it('does the same in the digest', async () => {
    const { s, signalWithStart } = service();
    await s.inAppNotification('org1', 'Could not post', `Channel ${HOSTILE_NAME} failed`, true, true, 'fail');

    const queued = (signalWithStart.mock.calls[0] as any[])[1].signalArgs[0][0];
    expect(queued.message).not.toContain('<a');
    expect(queued.message).toContain('&lt;a href=');
  });

  it('keeps line breaks', async () => {
    const { s, sent } = service();
    await s.inAppNotification('org1', 'Posted', 'First line\nSecond line', true);

    expect(sent[0].html).toBe('First line<br/>Second line');
  });

  it('leaves the in-app list and the push as they were', async () => {
    const { s, push, repo } = service();
    await s.inAppNotification('org1', 'Posted', 'Tom & Jerry <3', true);

    expect(repo.createNotification).toHaveBeenCalledWith('org1', 'Tom & Jerry <3');
    expect(push.notifyOrg).toHaveBeenCalledWith('org1', 'Posted', 'Tom & Jerry <3', 'success', undefined, undefined);
  });
});

describe('mail heading', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('shows the subject as text', async () => {
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@example.com';
    process.env.EMAIL_FROM_NAME = 'Postra';
    const sent: unknown[][] = [];
    const s = new EmailService({} as never);
    s.emailService = {
      name: 'test',
      validateEnvKeys: [],
      sendEmail: async (...args: unknown[]) => {
        sent.push(args);
        return {};
      },
    } as never;

    await s.sendEmailSync('user@example.com', `Could not post to ${HOSTILE_NAME}`, '<p>x</p>');

    const html = sent[0].find((a) => typeof a === 'string' && a.includes('<h1')) as string;
    expect(html).not.toContain('<a href="//evil.example">');
    expect(html).toContain('&lt;a href=&quot;//evil.example&quot;&gt;');
    // The Subject header is not markup and stays as written.
    expect(sent[0]).toContain(`Could not post to ${HOSTILE_NAME}`);
  });
});
