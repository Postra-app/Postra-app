import {
  channelState,
  isActionable,
  expiresInSeconds,
  CHANNEL_STATE_COPY,
  CHANNEL_STATES,
  REFRESH_WINDOW_MS,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/channel.state';

/**
 * The classifier exists because raw columns mislead.
 *
 * A dry run of `refresh` on production printed `3 channel(s) due` and that
 * read as an incident; it was the resting state of two providers with
 * short-lived tokens (E2E-09-59). These lock the distinction down, because it
 * is the entire value of the tab: an operator has to be able to tell "this is
 * fine" from "the customer has to reconnect" without opening a database.
 */

const NOW = new Date('2026-09-11T12:00:00Z').getTime();
const inHours = (hours: number) => new Date(NOW + hours * 3600 * 1000);

describe('channelState', () => {
  it('calls a channel with no expiry OK, not unknown', () => {
    // facebook, instagram through facebook, x and telegram all report
    // expiresIn: 0 at connect time, so tokenExpiration stays null forever.
    // Rendering that as a blank cell reads as a fault on four providers in
    // perfect health.
    expect(channelState({ tokenExpiration: null }, NOW)).toBe('ok');
  });

  it('separates a short-lived token from a dead one', () => {
    // The distinction the CLI counter used to collapse.
    expect(channelState({ tokenExpiration: inHours(1) }, NOW)).toBe('expiring');
    expect(channelState({ tokenExpiration: inHours(23) }, NOW)).toBe('expiring');
    expect(channelState({ tokenExpiration: inHours(-1) }, NOW)).toBe('expired');
  });

  it('puts the 24h boundary where needsToBeRefreshed puts it', () => {
    const edge = new Date(NOW + REFRESH_WINDOW_MS);
    expect(channelState({ tokenExpiration: edge }, NOW)).toBe('expiring');
    expect(
      channelState({ tokenExpiration: new Date(NOW + REFRESH_WINDOW_MS + 1000) }, NOW)
    ).toBe('ok');
  });

  it('reports a failed refresh as the one real alarm', () => {
    expect(
      channelState({ refreshNeeded: true, tokenExpiration: inHours(100) }, NOW)
    ).toBe('needs-reconnect');
  });

  it('does not tell the operator to reconnect a channel that is switched off', () => {
    // Over the plan limit after a downgrade. "Reconnect it" is the wrong
    // answer to "why is my channel not posting" — the answer is the plan.
    expect(
      channelState({ disabled: true, refreshNeeded: true }, NOW)
    ).toBe('disabled');
  });

  it('does not call an unfinished connect a reconnect', () => {
    expect(
      channelState({ inBetweenSteps: true, refreshNeeded: true }, NOW)
    ).toBe('setup-incomplete');
  });

  it('lets a deleted channel say so instead of looking broken', () => {
    expect(
      channelState(
        { deletedAt: inHours(-50), refreshNeeded: true, disabled: true },
        NOW
      )
    ).toBe('deleted');
  });

  it('accepts a date that arrived over the wire as a string', () => {
    expect(
      channelState({ tokenExpiration: inHours(-2).toISOString() }, NOW)
    ).toBe('expired');
  });

  it('treats an unparseable date as no expiry rather than as expired', () => {
    expect(channelState({ tokenExpiration: 'not a date' }, NOW)).toBe('ok');
  });
});

describe('isActionable', () => {
  it('leaves the normal short-token state alone', () => {
    // The headline count on the tab is built from this. If `expiring` counted,
    // the tab would open on "3 channels need attention" every single day.
    expect(isActionable('expiring', false)).toBe(false);
    expect(isActionable('ok', false)).toBe(false);
  });

  it('acts on an expired token only when no workflow is watching it', () => {
    // Same rule the CLI prints, so the tab and `refresh` cannot disagree.
    expect(isActionable('expired', false)).toBe(true);
    expect(isActionable('expired', true)).toBe(false);
  });

  it('always acts on a reconnect and an unfinished setup', () => {
    expect(isActionable('needs-reconnect', true)).toBe(true);
    expect(isActionable('setup-incomplete', true)).toBe(true);
  });

  it('does not chase a channel nobody uses', () => {
    expect(isActionable('disabled', false)).toBe(false);
    expect(isActionable('deleted', false)).toBe(false);
  });
});

describe('expiresInSeconds', () => {
  it('is null when the provider reports no expiry', () => {
    expect(expiresInSeconds(null, NOW)).toBeNull();
  });

  it('goes negative once the token is already dead', () => {
    expect(expiresInSeconds(inHours(-2), NOW)).toBe(-7200);
    expect(expiresInSeconds(inHours(3), NOW)).toBe(10800);
  });
});

describe('the wording', () => {
  it('covers every state, so no badge can render blank', () => {
    for (const state of CHANNEL_STATES) {
      expect(CHANNEL_STATE_COPY[state]?.label).toBeTruthy();
      expect(CHANNEL_STATE_COPY[state]?.hint).toBeTruthy();
    }
  });

  it('says outright that an expiring token is normal', () => {
    // The sentence is the feature. Without it the number reads as an
    // emergency, which is exactly what happened the last time.
    expect(CHANNEL_STATE_COPY.expiring.hint).toMatch(/normal/i);
  });
});
