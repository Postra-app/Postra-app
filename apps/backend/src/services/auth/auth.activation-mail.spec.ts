jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
// Addresses SES drops mail to. The rest is the real module.
const bouncing = new Set<string>();
jest.mock('@gitroom/nestjs-libraries/emails/undeliverable.address', () => ({
  ...jest.requireActual('@gitroom/nestjs-libraries/emails/undeliverable.address'),
  isUndeliverable: async (email: string) => bouncing.has(email),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendActivationMail } = require('./auth.service');

// Sign-in mails go out directly, never through the Temporal mail queue: with
// the queue down registration failed, with its workflow stuck the
// queue still took signals and nothing left, and the reset mail vanished
// without a log (upstream 1f5f24e5).
describe('activation mail', () => {
  it('is sent directly', async () => {
    const e = { sendEmail: jest.fn(), sendEmailSync: jest.fn().mockResolvedValue(undefined) };
    await sendActivationMail(e, 'a@b.co', 'Activate', '<p>x</p>', 'Footer');
    expect(e.sendEmailSync).toHaveBeenCalledWith('a@b.co', 'Activate', '<p>x</p>', undefined, 'Footer');
    expect(e.sendEmail).not.toHaveBeenCalled();
  });
});

// "Forgot password" says what happened instead of always "we have sent you
// an email". It no longer answers before the mail is sent: registration
// already tells which addresses have accounts, so equal timing hid nothing.
describe('forgot password', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AuthService } = require('./auth.service');
  const make = (user: unknown, sendEmailSync = jest.fn().mockResolvedValue(true)) => {
    const service = Object.create(AuthService.prototype);
    Object.assign(service, {
      _userService: { getUserByEmail: async () => user },
      _emailService: { sendEmailSync },
    });
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    return { service, sendEmailSync };
  };
  const local = { id: 'u1', email: 'a@b.co', providerName: 'LOCAL', tokenVersion: 1 };

  it('says there is no account, and sends nothing', async () => {
    const { service, sendEmailSync } = make(null);
    expect(await service.forgot('nobody@b.co')).toEqual({ forgot: false, reason: 'no_account' });
    expect(sendEmailSync).not.toHaveBeenCalled();
  });

  it('names the provider an account signs in with, and sends nothing', async () => {
    const { service, sendEmailSync } = make({ ...local, providerName: 'GOOGLE' });
    expect(await service.forgot('a@b.co')).toEqual({ forgot: false, reason: 'provider', provider: 'GOOGLE' });
    expect(sendEmailSync).not.toHaveBeenCalled();
  });

  it('says sent only once the mail went out', async () => {
    const { service, sendEmailSync } = make(local);
    expect(await service.forgot('a@b.co')).toEqual({ forgot: true });
    expect(sendEmailSync).toHaveBeenCalledTimes(1);
  });

  it('says the mail failed when it could not be sent', async () => {
    const { service } = make(local, jest.fn().mockResolvedValue(false));
    expect(await service.forgot('a@b.co')).toEqual({ forgot: false, reason: 'send_failed' });
    const { service: throwing } = make(local, jest.fn().mockRejectedValue(new Error('SMTP down')));
    expect(await throwing.forgot('a@b.co')).toEqual({ forgot: false, reason: 'send_failed' });
  });
});

// SES drops mail to an address on its suppression list and the form said
// "sent". It says the address bounces, and sends nothing.
describe('an address mail cannot reach', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AuthService } = require('./auth.service');
  const text = "Emails to this address are bouncing, so we can't send you the link. Check it for typos or use a different address. Need help? Write to hello@postra.co.uk.";
  afterEach(() => bouncing.clear());
  const make = (user: unknown) => {
    const service = Object.create(AuthService.prototype);
    const sendEmailSync = jest.fn().mockResolvedValue(true);
    Object.assign(service, {
      _userService: { getUserByEmail: async () => user },
      _emailService: { sendEmailSync },
      activationToken: () => 'jwt',
    });
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    return { service, sendEmailSync };
  };

  it('forgot password says so instead of sending', async () => {
    bouncing.add('typo@b.co');
    const { service, sendEmailSync } = make({ id: 'u1', email: 'typo@b.co', providerName: 'LOCAL', tokenVersion: 1 });
    expect(await service.forgot('typo@b.co')).toEqual({ forgot: false, reason: 'undeliverable' });
    expect(sendEmailSync).not.toHaveBeenCalled();
  });

  it('resending the activation says so instead of sending', async () => {
    bouncing.add('typo@b.co');
    const { service, sendEmailSync } = make({ id: 'u1', email: 'typo@b.co', providerName: 'LOCAL', activated: false });
    await expect(service.resendActivationEmail('typo@b.co')).rejects.toMatchObject({ reason: 'undeliverable', message: text });
    expect(sendEmailSync).not.toHaveBeenCalled();
  });

  it('an address that is not on the list gets its mail', async () => {
    const { service, sendEmailSync } = make({ id: 'u1', email: 'ok@b.co', providerName: 'LOCAL', activated: false });
    await expect(service.resendActivationEmail('ok@b.co')).resolves.toBe(true);
    expect(sendEmailSync).toHaveBeenCalledTimes(1);
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
    expect(sendEmailSync).toHaveBeenCalledWith('a@b.co', expect.any(String), expect.stringContaining('/auth/forgot/'), undefined, expect.stringContaining('B K Company'));
    expect(queue).not.toHaveBeenCalled();
  });
});


// "This is not a banking app". A password found in a public
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
      _userService: { getUserById: async () => ({ id: 'u1', tokenVersion: 1, activated: true }), updatePassword },
    });
    const token = AuthChecker.signJWT({ id: 'u1', tokenVersion: 1, expires: new Date(Date.now() + 600_000).toISOString(), purpose: 'reset' });

    await expect(service.forgotReturn({ token, password: 'password123', repeatPassword: 'password123' })).resolves.toBe(true);
    expect(updatePassword).toHaveBeenCalledWith('u1', 'password123', 1);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('pwnedpasswords'))).toBe(false);
    fetchSpy.mockRestore();
  });
});

// 18 Oct: the activation mail landed in Yahoo spam. It was one "click here"
// link with no address shown, and a footer about notification settings sent
// to someone who has no account yet.
describe('sign-in mail content', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { authEmails, authEmailFooter } = require('./auth.emails');
  const url = 'https://app.postra.co.uk/auth/activate/abc.def';
  it.each(['en', 'pl'])('%s activation and reset show the link written out and an ignore line', (lang) => {
    for (const mail of [authEmails.activation[lang], authEmails.resetPassword[lang]]) {
      const html = mail.html(url);
      expect(html).toContain(`>${url}</a>`);
      expect(html.match(/<a /g)?.length).toBe(2);
      expect(html).not.toMatch(/>here<|>tutaj</);
      expect(html).toMatch(/ignore this email|zignoruj tę wiadomość/);
      expect(html + mail.subject).not.toMatch(/[\u2013\u2014]/);
    }
    expect(authEmailFooter[lang]).toContain('B K Company, Suite RA01, 195-197 Wood Street, London E17 3NU');
  });
  it('English subjects', () => {
    expect(authEmails.activation.en.subject).toBe('Confirm your email address for Postra');
    expect(authEmails.resetPassword.en.subject).toBe('Reset your Postra password');
  });
});

describe('mail footer', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EmailService } = require('@gitroom/nestjs-libraries/services/email.service');
  const send = async (footer?: string) => {
    const service = Object.create(EmailService.prototype);
    const sendEmail = jest.fn().mockResolvedValue(undefined);
    Object.assign(service, { emailService: { sendEmail }, _logger: { warn: jest.fn(), error: jest.fn() } });
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@postra.co.uk';
    process.env.EMAIL_FROM_NAME = 'Postra';
    await service.sendEmailSync('a@b.co', 'S', '<p>x</p>', undefined, footer);
    return sendEmail.mock.calls[0][2] as string;
  };
  it('a sign-in mail carries who sends it, not the notification settings line', async () => {
    const html = await send('Postra is operated by B K Company.');
    expect(html).toContain('Postra is operated by B K Company.');
    expect(html).not.toContain('notification preferences');
  });
  it('other mails keep the notification settings line', async () => {
    expect(await send()).toContain('notification preferences');
  });
});

// A module, so its require() bindings do not collide with other specs.
export {};
