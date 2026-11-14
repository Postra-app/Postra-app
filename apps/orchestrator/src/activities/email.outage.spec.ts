jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: () => Promise.resolve(),
}));

import {
  EmailService,
  isTransientMailError,
} from '@gitroom/nestjs-libraries/services/email.service';
import { EmailActivity } from './email.activity';

// A queued mail has already left the queue when this activity runs. It used
// to answer "done" whatever happened, so an outage of the mail provider
// longer than the service's own ~1.4 s of tries dropped every notification
// queued in that time. Now the activity fails for an outage, and Temporal
// tries it again (send.email.workflow).
describe('queued mail while the mail provider is unavailable', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.EMAIL_PROVIDER = '';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@example.com';
    process.env.EMAIL_FROM_NAME = 'Postra';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  const activity = (send: () => Promise<unknown>) => {
    const service = new EmailService({} as never);
    const sendEmail = jest.fn(send);
    service.emailService = {
      name: 'test',
      validateEnvKeys: [],
      sendEmail,
    } as never;
    return { activity: new EmailActivity(service, {} as never), sendEmail };
  };
  const smtpError = (fields: { code?: string; responseCode?: number }) =>
    Object.assign(new Error('smtp'), fields);

  it('fails, to be tried again, when the provider cannot be reached', async () => {
    const { activity: a, sendEmail } = activity(async () => {
      throw smtpError({ code: 'ECONNECTION' });
    });

    await expect(
      a.sendEmail('user@example.com', 'Your post failed', '<p>x</p>')
    ).rejects.toThrow('The mail provider is unavailable');
    expect(sendEmail).toHaveBeenCalledTimes(3);
  });

  it('fails, to be tried again, when the provider says "not now"', async () => {
    const { activity: a } = activity(async () => {
      throw smtpError({ code: 'EMESSAGE', responseCode: 454 });
    });

    await expect(
      a.sendEmail('user@example.com', 'Your post failed', '<p>x</p>')
    ).rejects.toThrow('The mail provider is unavailable');
  });

  it('gives up on a mail the provider refuses, without holding the queue', async () => {
    const { activity: a } = activity(async () => {
      throw smtpError({ code: 'EENVELOPE', responseCode: 550 });
    });

    await expect(
      a.sendEmail('gone@example.com', 'Your post failed', '<p>x</p>')
    ).resolves.toBe(false);
  });

  it('gives up on an address that is not one', async () => {
    const { activity: a, sendEmail } = activity(async () => ({}));

    await expect(a.sendEmail('nobody', 'x', '<p>x</p>')).resolves.toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('answers true for a mail that went out', async () => {
    const { activity: a } = activity(async () => ({}));

    await expect(
      a.sendEmail('user@example.com', 'Your post failed', '<p>x</p>')
    ).resolves.toBe(true);
  });

  it.each([
    [{ code: 'ETIMEDOUT' }, true],
    [{ code: 'EDNS' }, true],
    [{ responseCode: 421 }, true],
    [{ responseCode: 451 }, true],
    [{ responseCode: 554 }, false],
    [{ code: 'EAUTH', responseCode: 535 }, false],
    [{ code: 'EAUTH' }, false],
    [{}, false],
  ])('%j is an outage: %s', (fields, expected) => {
    expect(isTransientMailError(smtpError(fields))).toBe(expected);
  });
});
