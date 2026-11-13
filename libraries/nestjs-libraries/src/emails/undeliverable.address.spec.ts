import { isUndeliverable, sesRegionOf } from './undeliverable.address';

// SES drops mail to an address on its suppression list and the
// app saw "sent". The lookup asks the list, and only when the mail goes
// through SES.
describe('sesRegionOf', () => {
  it.each([
    ['email-smtp.eu-west-1.amazonaws.com', 'eu-west-1'],
    ['email-smtp.us-gov-west-1.amazonaws.com', 'us-gov-west-1'],
    ['email-smtp-fips.us-east-1.amazonaws.com', 'us-east-1'],
    [' Email-Smtp.EU-WEST-2.amazonaws.com ', 'eu-west-2'],
  ])('%s → %s', (host, region) => {
    expect(sesRegionOf(host)).toBe(region);
  });

  it.each(['smtp.gmail.com', 'smtp.resend.com', 'email-smtp.eu-west-1.amazonaws.com.evil.example', '', undefined, null])(
    '%s is not SES',
    (host) => {
      expect(sesRegionOf(host as string)).toBeNull();
    }
  );
});

describe('isUndeliverable', () => {
  const ses = 'email-smtp.eu-west-1.amazonaws.com';
  const notFound = Object.assign(new Error('not on the list'), { name: 'NotFoundException' });

  it('is true for an address on the suppression list, asked in lower case', async () => {
    const send = jest.fn().mockResolvedValue({ SuppressedDestination: { Reason: 'BOUNCE' } });
    expect(await isUndeliverable(' Typo@Example.COM ', { host: ses, client: { send } as any })).toBe(true);
    expect(send.mock.calls[0][0].input).toEqual({ EmailAddress: 'typo@example.com' });
  });

  it('is false for an address the list does not have', async () => {
    const send = jest.fn().mockRejectedValue(notFound);
    expect(await isUndeliverable('ok@example.com', { host: ses, client: { send } as any })).toBe(false);
  });

  it('does not ask anything when the mail does not go through SES', async () => {
    const send = jest.fn();
    expect(await isUndeliverable('ok@example.com', { host: 'smtp.gmail.com', client: { send } as any })).toBe(false);
    expect(await isUndeliverable('ok@example.com', { host: null, client: { send } as any })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('a failed lookup lets the mail go as before', async () => {
    const denied = Object.assign(new Error('not authorized'), { name: 'AccessDeniedException' });
    const send = jest.fn().mockRejectedValue(denied);
    expect(await isUndeliverable('ok@example.com', { host: ses, client: { send } as any })).toBe(false);
  });
});
