/**
 * What state a channel is in, as one word.
 *
 * The panel could show `tokenExpiration`, `refreshNeeded` and `disabled` as
 * three raw columns and call the job done. That rebuilds the defect E2E-09-59
 * named: a dry run of `refresh` printed `3 channel(s) due` and it read as an
 * incident, when YouTube holds a token for about an hour and TikTok for 23,
 * so both are due to be refreshed permanently. That is the resting state of a
 * healthy account. An operator handed the raw date makes the same wrong
 * inference, only faster.
 *
 * So the classification happens once, here, and both the endpoint filter and
 * the on-screen badge read this module. Two definitions of the same thing is
 * how the tier badge ended up at 2.64:1 in one tab and correct in the other
 * (E2E-09-55).
 *
 * No imports on purpose: the frontend bundles this file too.
 */

export type ChannelState =
  | 'deleted'
  | 'disabled'
  | 'setup-incomplete'
  | 'needs-reconnect'
  | 'expired'
  | 'expiring'
  | 'ok';

export const CHANNEL_STATES: ChannelState[] = [
  'needs-reconnect',
  'setup-incomplete',
  'disabled',
  'expired',
  'expiring',
  'ok',
  'deleted',
];

/** The columns the verdict is made of — a plain shape, not the Prisma row. */
export interface ChannelStateInput {
  refreshNeeded?: boolean | null;
  inBetweenSteps?: boolean | null;
  disabled?: boolean | null;
  deletedAt?: Date | string | null;
  tokenExpiration?: Date | string | null;
}

/** Tokens due for a refresh are selected by `tokenExpiration <= now + 24h`. */
export const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

const asTime = (value: Date | string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

/**
 * First match wins, and the order is the order of what the operator should say
 * to the customer:
 *
 * - `deleted` and `disabled` come first because a channel that is not in use
 *   does not need reconnecting — telling a customer to reconnect a channel we
 *   switched off when their plan shrank is the wrong answer to their question.
 * - `setup-incomplete` outranks `needs-reconnect` because the connect flow
 *   never finished in the first place, so "reconnect" describes something that
 *   never happened.
 * - `expiring` is last before `ok` because for YouTube and TikTok it is the
 *   normal state, not a fault.
 *
 * A null `tokenExpiration` is `ok`, not unknown: facebook, instagram through
 * facebook, x and telegram all report `expiresIn: 0` at connect time and never
 * carry an expiry (measured, E2E-09-59).
 */
export const channelState = (
  channel: ChannelStateInput,
  now: number = Date.now()
): ChannelState => {
  if (channel.deletedAt) {
    return 'deleted';
  }
  if (channel.disabled) {
    return 'disabled';
  }
  if (channel.inBetweenSteps) {
    return 'setup-incomplete';
  }
  if (channel.refreshNeeded) {
    return 'needs-reconnect';
  }

  const expiration = asTime(channel.tokenExpiration);
  if (expiration === null) {
    return 'ok';
  }
  if (expiration <= now) {
    return 'expired';
  }
  if (expiration <= now + REFRESH_WINDOW_MS) {
    return 'expiring';
  }
  return 'ok';
};

/**
 * Whether this row is something to act on today.
 *
 * `scheduled` is `!!provider.refreshCron`, which is what puts a channel under
 * `refreshTokenWorkflow` — only instagram-standalone, threads and whop have
 * it, because only they hold tokens long enough to die between posts. The
 * rest refresh reactively on a 401 while publishing, by design.
 *
 * Deliberately the same rule the CLI prints ("already expired, of which not
 * on a scheduled refresh"), so the headline on the tab and the output of
 * `refresh` cannot disagree about the same channel.
 */
export const isActionable = (
  state: ChannelState,
  scheduled: boolean
): boolean => {
  if (state === 'needs-reconnect' || state === 'setup-incomplete') {
    return true;
  }
  if (state === 'expired') {
    return !scheduled;
  }
  return false;
};

interface StateCopy {
  label: string;
  /** One line saying what it means, written for someone on the phone. */
  hint: string;
}

/**
 * The wording, kept beside the rule.
 *
 * `expiring` says outright that it is normal, because the whole reason this
 * feature exists is that the same number read as an emergency the last time
 * somebody saw it without that sentence.
 */
export const CHANNEL_STATE_COPY: Record<ChannelState, StateCopy> = {
  'needs-reconnect': {
    label: 'Needs reconnect',
    hint: 'A refresh failed. The customer has to connect this channel again.',
  },
  'setup-incomplete': {
    label: 'Setup incomplete',
    hint: 'Connecting was started and never finished, so this channel cannot publish.',
  },
  disabled: {
    label: 'Disabled',
    hint: 'Switched off — over the plan channel limit, or disabled by hand.',
  },
  expired: {
    label: 'Token expired',
    hint: 'The token is dead. It is refreshed on the next publish, or by a scheduled refresh where the provider has one.',
  },
  expiring: {
    label: 'Expires within 24h',
    hint: 'Normal for YouTube (about an hour) and TikTok (23 hours). Not a fault.',
  },
  ok: {
    label: 'OK',
    hint: 'Nothing to do.',
  },
  deleted: {
    label: 'Deleted',
    hint: 'Removed by the customer. Kept as a row, not shown in their app.',
  },
};

/**
 * How long until the token dies, in seconds — negative once it already has.
 * `null` when the provider does not report an expiry at all, which the panel
 * must render as "does not expire" rather than as an empty cell.
 */
export const expiresInSeconds = (
  tokenExpiration: Date | string | null | undefined,
  now: number = Date.now()
): number | null => {
  const expiration = asTime(tokenExpiration);
  return expiration === null ? null : Math.round((expiration - now) / 1000);
};
