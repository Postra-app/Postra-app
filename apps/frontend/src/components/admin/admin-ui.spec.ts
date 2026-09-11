import {
  channelStateBadgeClass,
  formatExpiry,
  serverReason,
  tierBadgeClass,
  tierLabel,
  withReason,
} from '@gitroom/frontend/components/admin/admin-ui';
import { CHANNEL_STATES } from '@gitroom/nestjs-libraries/database/prisma/integrations/channel.state';

/**
 * The tier pill was defined twice for the same six tiers, and the copy in
 * Subscriptions put white text on a pastel fill. Measured in the live DOM
 * against its own background: 2.64:1, where 11px text needs 4.5:1
 * (E2E-09-55 — the first pass fixed the /30 opacities and never looked at
 * this pill). Testing the class rather than the colour, because the thing that
 * went wrong was two definitions, not one bad value.
 */
describe('tierBadgeClass', () => {
  it('gives the same pill to the same tier wherever it is rendered', () => {
    expect(tierBadgeClass('ULTIMATE')).toBe(tierBadgeClass('ULTIMATE'));
  });

  it('never puts white text on a solid fill', () => {
    for (const tier of [
      'ULTIMATE',
      'PRO',
      'TEAM',
      'STANDARD',
      'FREE',
      'SOMETHING_ELSE',
      null,
      undefined,
    ]) {
      expect(tierBadgeClass(tier)).not.toContain('text-white');
    }
  });

  it('uses a tinted fill, so the saturated text has headroom', () => {
    expect(tierBadgeClass('ULTIMATE')).toContain('bg-purple-500/20');
    expect(tierBadgeClass('ULTIMATE')).toContain('text-purple-400');
  });

  it('treats a missing tier as FREE and not as an error', () => {
    // FREE is the commonest tier there is; falling through to the error colour
    // painted every free account red (E2E-09-29).
    expect(tierLabel(null)).toBe('FREE');
    expect(tierLabel(undefined)).toBe('FREE');
    expect(tierBadgeClass(null)).toBe(tierBadgeClass('FREE'));
    expect(tierBadgeClass(null)).not.toContain('text-red-400');
  });

  it('keeps red for a tier the map does not know', () => {
    expect(tierBadgeClass('MYSTERY')).toContain('text-red-400');
  });
});

/**
 * Comping an organization with a live Stripe customer answers 400 "This
 * organization has a live Stripe customer — change the plan in Stripe
 * instead", measured on production. The operator saw "Failed to add the
 * subscription" and nothing else: the actionable half never arrived.
 */
describe('serverReason', () => {
  const jsonResponse = (body: unknown, status = 400) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it('returns the message Nest sent', async () => {
    const res = jsonResponse({
      statusCode: 400,
      message: 'This organization has a live Stripe customer',
    });
    await expect(serverReason(res)).resolves.toBe(
      'This organization has a live Stripe customer'
    );
  });

  it('joins the array class-validator sends', async () => {
    const res = jsonResponse({
      message: [
        'title must be shorter than or equal to 200 characters',
        'description should not be null or undefined',
      ],
    });
    await expect(serverReason(res)).resolves.toBe(
      'title must be shorter than or equal to 200 characters; description should not be null or undefined'
    );
  });

  it('returns nothing for a body that is not JSON', async () => {
    const res = new Response('<html>502</html>', { status: 502 });
    await expect(serverReason(res)).resolves.toBeNull();
  });

  it('returns nothing when there is no message', async () => {
    await expect(serverReason(jsonResponse({ statusCode: 400 }))).resolves.toBeNull();
  });

  it('leaves the response readable for the caller', async () => {
    // The panel reads the body again after showing the toast; clone() is why
    // this does not consume it.
    const res = jsonResponse({ message: 'nope' });
    await serverReason(res);
    await expect(res.json()).resolves.toEqual({ message: 'nope' });
  });

  it('appends the reason to the generic line', async () => {
    const res = jsonResponse({ message: 'live Stripe customer' });
    await expect(withReason(res, 'Failed to add the subscription')).resolves.toBe(
      'Failed to add the subscription: live Stripe customer'
    );
  });

  it('keeps the generic line alone when the server gave no reason', async () => {
    const res = new Response('', { status: 500 });
    await expect(withReason(res, 'Failed to add the subscription')).resolves.toBe(
      'Failed to add the subscription'
    );
  });
});

describe('the channel state pill', () => {
  it('does not paint a normal short-lived token as a warning', () => {
    // The whole tab exists because "expires within 24 hours" was read as an
    // incident. Amber or red here would say the same wrong thing in colour.
    const expiring = channelStateBadgeClass('expiring');
    expect(expiring).toContain('sky');
    expect(expiring).not.toMatch(/red|amber|orange/);
  });

  it('keeps red for the one state that needs a phone call', () => {
    expect(channelStateBadgeClass('needs-reconnect')).toContain('red');
  });

  it('gives every state its own pairing, with no blank fallback', () => {
    const seen = CHANNEL_STATES.map((state) => channelStateBadgeClass(state));
    for (const classes of seen) {
      expect(classes).toMatch(/bg-/);
      expect(classes).toMatch(/text-/);
      expect(classes).toMatch(/border-/);
    }
  });
});

describe('formatExpiry', () => {
  it('says a provider does not expire rather than leaving the cell blank', () => {
    // Four providers never report an expiry. A blank cell reads as a fault.
    expect(formatExpiry(null)).toBe('Does not expire');
    expect(formatExpiry(undefined)).toBe('Does not expire');
  });

  it('says how long ago a dead token died', () => {
    expect(formatExpiry(-3600)).toBe('Expired 1h ago');
    expect(formatExpiry(-60 * 60 * 24 * 3)).toBe('Expired 3d ago');
  });

  it('reads in minutes while that is still the useful unit', () => {
    expect(formatExpiry(600)).toBe('in 10m');
    expect(formatExpiry(3600 * 5)).toBe('in 5h');
  });

  it('never rounds a live token down to zero', () => {
    expect(formatExpiry(20)).toBe('in 1m');
  });
});
