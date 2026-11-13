import {
  GetSuppressedDestinationCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import { Logger } from '@nestjs/common';

/**
 * Whether mail to an address is being dropped by the sender, so a sign-in
 * link would never arrive.
 *
 * Amazon SES puts an address that bounced hard, or whose owner marked a mail
 * as spam, on the account's suppression list and from then on accepts every
 * mail to it over SMTP and quietly drops it. The app saw "sent": a typo in the
 * sign-up address meant activation and reset links "went out" and nothing
 * came, and neither the person nor the app knew why. The list is
 * the sender's own record, so asking it is enough: no bounce feed to receive,
 * no copy of addresses kept here.
 *
 * Only for SES: the region comes from its SMTP host
 * (email-smtp.<region>.amazonaws.com). Any other mail server answers false.
 * A lookup that fails (no permission, SES slow) answers false too: the mail
 * is tried as before rather than refused on a guess.
 */

const SES_SMTP_HOST =
  /^email-smtp(?:-fips)?\.([a-z]{2}(?:-[a-z]+)+-\d)\.amazonaws\.com$/i;

/** The SES region behind an SMTP host, or null when it is not SES. */
export const sesRegionOf = (host?: string | null): string | null =>
  SES_SMTP_HOST.exec((host || '').trim())?.[1]?.toLowerCase() ?? null;

type Lookup = Pick<SESv2Client, 'send'>;

let cached: { region: string; client: Lookup } | undefined;
const clientFor = (region: string): Lookup => {
  if (cached?.region !== region) {
    cached = { region, client: new SESv2Client({ region, maxAttempts: 2 }) };
  }
  return cached.client;
};

let warned = false;

export async function isUndeliverable(
  email: string,
  options: { host?: string | null; client?: Lookup } = {}
): Promise<boolean> {
  const region = sesRegionOf(
    options.host === undefined ? process.env.EMAIL_HOST : options.host
  );
  const address = (email || '').trim().toLowerCase();
  if (!region || !address) {
    return false;
  }
  try {
    await (options.client ?? clientFor(region)).send(
      new GetSuppressedDestinationCommand({ EmailAddress: address }),
      { abortSignal: AbortSignal.timeout(3_000) }
    );
    // Found on the list.
    return true;
  } catch (err) {
    if ((err as { name?: string })?.name === 'NotFoundException') {
      return false;
    }
    if (!warned) {
      warned = true;
      new Logger('UndeliverableAddress').warn(
        `suppression list lookup failed, mail is sent as before: ${
          (err as Error)?.name || 'Error'
        } ${String((err as Error)?.message || '').slice(0, 160)}`
      );
    }
    return false;
  }
}

/** What the person reads when their address is on the list. */
export const UNDELIVERABLE_MESSAGE =
  "Emails to this address are bouncing, so we can't send you the link. Check it for typos or use a different address. Need help? Write to hello@postra.co.uk.";

export class UndeliverableAddressError extends Error {
  readonly reason = 'undeliverable' as const;
  constructor() {
    super(UNDELIVERABLE_MESSAGE);
    this.name = 'UndeliverableAddressError';
  }
}
