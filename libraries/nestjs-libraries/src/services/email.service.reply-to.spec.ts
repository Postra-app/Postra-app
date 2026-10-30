import { EmailService } from './email.service';

// Mail goes out from an address with no mailbox. A customer answering a
// password reset or an invitation reached nobody: every mail now carries
// EMAIL_REPLY_TO unless the caller names its own Reply-To (an operator
// notification answers the customer it is about).
describe('EmailService Reply-To', () => {
  const env = { ...process.env };
  let sent: unknown[][];

  beforeEach(() => {
    process.env.EMAIL_PROVIDER = '';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@example.com';
    process.env.EMAIL_FROM_NAME = 'Postra';
    process.env.EMAIL_REPLY_TO = 'hello@example.com';
    sent = [];
  });
  afterEach(() => {
    process.env = { ...env };
  });

  const service = () => {
    const s = new EmailService({} as never);
    s.emailService = {
      name: 'test',
      validateEnvKeys: [],
      sendEmail: async (...args: unknown[]) => {
        sent.push(args);
        return {};
      },
    } as never;
    return s;
  };

  it('replies go to EMAIL_REPLY_TO by default', async () => {
    expect(await service().sendEmailSync('user@example.com', 'Reset your password', '<p>x</p>')).toBe(true);
    expect(sent[0][5]).toBe('hello@example.com');
  });

  it("keeps the caller's own Reply-To", async () => {
    await service().sendEmailSync('ops@example.com', 'Cancelled', '<p>x</p>', 'customer@example.com');
    expect(sent[0][5]).toBe('customer@example.com');
  });

  it('sends no Reply-To when none is configured', async () => {
    delete process.env.EMAIL_REPLY_TO;
    await service().sendEmailSync('user@example.com', 'Reset your password', '<p>x</p>');
    expect(sent[0][5]).toBeUndefined();
  });
});
