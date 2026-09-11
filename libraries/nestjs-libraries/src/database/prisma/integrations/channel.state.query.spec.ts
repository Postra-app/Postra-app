import {
  channelState,
  ChannelState,
  CHANNEL_STATES,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/channel.state';
import {
  channelStateWhere,
  notScheduledWhere,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/channel.state.query';

/**
 * One rule, two expressions, and this is what keeps them equal.
 *
 * The classifier decides what a badge says; the query fragment decides what a
 * filter returns and what the header counts. Left to drift they disagree
 * quietly — the tab would show eight rows under a filter whose own counter
 * said seven, and nobody would know which number to believe. So every
 * synthetic row below is put through both, and a state may match exactly one
 * fragment: its own.
 */

const NOW = new Date('2026-09-11T12:00:00Z');
const hours = (n: number) => new Date(NOW.getTime() + n * 3600 * 1000);

interface Row {
  why: string;
  deletedAt?: Date | null;
  disabled?: boolean;
  inBetweenSteps?: boolean;
  refreshNeeded?: boolean;
  tokenExpiration?: Date | null;
}

const base = {
  deletedAt: null,
  disabled: false,
  inBetweenSteps: false,
  refreshNeeded: false,
  tokenExpiration: null,
};

const rows: Row[] = [
  { why: 'facebook, no expiry ever reported' },
  { why: 'a long-lived token', tokenExpiration: hours(1400) },
  { why: 'youtube, about an hour left', tokenExpiration: hours(1) },
  { why: 'tiktok, 23 hours left', tokenExpiration: hours(23) },
  { why: 'exactly on the 24h boundary', tokenExpiration: hours(24) },
  { why: 'a token that died an hour ago', tokenExpiration: hours(-1) },
  { why: 'a refresh that failed', refreshNeeded: true },
  {
    why: 'a refresh that failed on a still-valid token',
    refreshNeeded: true,
    tokenExpiration: hours(500),
  },
  { why: 'a connect flow never finished', inBetweenSteps: true },
  { why: 'switched off after a downgrade', disabled: true },
  {
    why: 'switched off and flagged for reconnect',
    disabled: true,
    refreshNeeded: true,
  },
  { why: 'removed by the customer', deletedAt: hours(-500) },
  {
    why: 'removed, and expired long before that',
    deletedAt: hours(-500),
    tokenExpiration: hours(-900),
  },
];

/**
 * The slice of Prisma's `where` syntax these fragments actually use.
 * Deliberately small: it exists to make the equivalence check real, not to
 * reimplement the client.
 */
const matchesCondition = (value: unknown, condition: unknown): boolean => {
  if (condition === null) {
    return value === null || value === undefined;
  }
  if (typeof condition === 'object' && condition !== null) {
    const c = condition as Record<string, unknown>;
    if ('not' in c) {
      return !matchesCondition(value, c.not);
    }
    const time = value instanceof Date ? value.getTime() : null;
    if ('lte' in c) {
      if (time === null || time > (c.lte as Date).getTime()) {
        return false;
      }
    }
    if ('gt' in c) {
      if (time === null || time <= (c.gt as Date).getTime()) {
        return false;
      }
    }
    if ('notIn' in c) {
      return !(c.notIn as unknown[]).includes(value);
    }
    return true;
  }
  return value === condition;
};

const matches = (where: Record<string, unknown>, row: Row): boolean =>
  Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      return (condition as Record<string, unknown>[]).some((branch) =>
        matches(branch, row)
      );
    }
    return matchesCondition((row as Record<string, unknown>)[key], condition);
  });

describe('channelStateWhere agrees with channelState', () => {
  for (const row of rows) {
    const full = { ...base, ...row };
    const state = channelState(full, NOW.getTime());

    it(`${row.why} → ${state}`, () => {
      const matched = CHANNEL_STATES.filter((candidate) =>
        matches(channelStateWhere(candidate, NOW), full)
      );

      // Exactly one, and the one the badge will show. Two means a row would be
      // counted twice in the header; zero means a filter that hides it.
      expect(matched).toEqual([state]);
    });
  }

  it('covers every row with exactly one state, so the counts add up', () => {
    const counted = CHANNEL_STATES.reduce(
      (sum, state) =>
        sum +
        rows.filter((row) =>
          matches(channelStateWhere(state, NOW), { ...base, ...row })
        ).length,
      0
    );
    expect(counted).toBe(rows.length);
  });
});

describe('notScheduledWhere', () => {
  it('excludes the providers a refresh workflow watches', () => {
    const where = notScheduledWhere(['threads', 'whop']);
    expect(matches(where, { why: '', ...base } as Row)).toBe(true);
    expect(
      matchesCondition(
        'threads',
        (where as { providerIdentifier: unknown }).providerIdentifier
      )
    ).toBe(false);
    expect(
      matchesCondition(
        'youtube',
        (where as { providerIdentifier: unknown }).providerIdentifier
      )
    ).toBe(true);
  });

  it('filters nothing when no provider is scheduled', () => {
    // An empty `notIn` matches nothing in Prisma, which would silently zero
    // the headline count rather than leaving it unfiltered.
    expect(notScheduledWhere([])).toEqual({});
  });
});
