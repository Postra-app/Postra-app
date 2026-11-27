jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { BillingController, cancelledMailText } from './billing.controller';

// During the trial the customer sees how much of it is left, in
// numbers ("Channels 1 / 2 · Posts 4 / 15 · AI images 3 / 10 · 3 days left").
describe('GET /billing/trial', () => {
  const build = (status: unknown = { endsAt: 5_000, hasCard: false, cancelled: false }) => {
    const subscriptionService = {
      postCap: jest.fn().mockResolvedValue({ anchor: new Date(0), limit: 15 }),
      checkCredits: jest.fn().mockResolvedValue({ credits: 7 }),
    };
    const stripeService = {
      trialStatus: jest.fn().mockResolvedValue(status),
      trialRanOut: jest.fn().mockResolvedValue(true),
    };
    const postsService = { countedPostsNow: jest.fn().mockResolvedValue(4) };
    const integrationService = { getIntegrationsList: jest.fn().mockResolvedValue([{ disabled: false }, { disabled: true }]) };
    const controller = new BillingController(
      subscriptionService as any,
      stripeService as any,
      {} as any,
      {} as any,
      {} as any,
      postsService as any,
      integrationService as any
    );
    return { controller, stripeService };
  };
  const org = { id: 'org-1', paymentId: 'cus_1', isTrailing: true, createdAt: new Date(0), subscription: { subscriptionTier: 'STANDARD', totalChannels: 4 } } as any;

  it('counts what the trial has used against what it includes', async () => {
    const { controller } = build();

    expect(await controller.trial(org)).toEqual({
      trial: true,
      endsAt: 5_000,
      hasCard: false,
      cancelled: false,
      channels: { used: 1, limit: 2 },
      posts: { used: 4, limit: 15 },
      images: { used: 3, limit: 10 },
    });
  });

  it('passes on that the trial was cancelled from Billing', async () => {
    const { controller } = build({ endsAt: 5_000, hasCard: true, cancelled: true });

    expect(await controller.trial(org)).toMatchObject({ trial: true, hasCard: true, cancelled: true });
  });

  it('no trial on a paid plan: no bar, and Stripe is not asked', async () => {
    const { controller, stripeService } = build();

    expect(await controller.trial({ ...org, isTrailing: false })).toEqual({ trial: false, ended: false });
    expect(stripeService.trialStatus).not.toHaveBeenCalled();
    expect(stripeService.trialRanOut).not.toHaveBeenCalled();
  });

  // The Android app sells no plans: it says the trial has ended instead of
  // showing an empty workspace.
  it('no plan after a trial that ran out says so', async () => {
    const { controller, stripeService } = build();

    expect(
      await controller.trial({ ...org, isTrailing: false, subscription: null })
    ).toEqual({ trial: false, ended: true });
    expect(stripeService.trialRanOut).toHaveBeenCalledWith('cus_1');
  });

  it('no plan and no Stripe customer: never had a trial', async () => {
    const { controller, stripeService } = build();

    expect(
      await controller.trial({ ...org, isTrailing: false, subscription: null, paymentId: null })
    ).toEqual({ trial: false, ended: false });
    expect(stripeService.trialRanOut).not.toHaveBeenCalled();
  });

  it('a trial Stripe no longer has shows no bar', async () => {
    const { controller } = build(null);

    expect(await controller.trial(org)).toEqual({ trial: false });
  });
});

// The mail that confirms a cancel said "You keep full access until…" to a
// trial too, which has the trial's limits.
describe('the cancel confirmation mail', () => {
  it('a trial keeps the trial until its end', () => {
    expect(cancelledMailText('1 December 2026', true)).toBe(
      'Your subscription has been cancelled and you will not be charged again. You keep your trial until 1 December 2026 (UTC). Changed your mind? You can re-activate any time from Billing.'
    );
  });

  it('a paid plan keeps full access until the period ends', () => {
    expect(cancelledMailText('1 December 2026', false)).toContain('You keep full access until 1 December 2026 (UTC).');
  });
});
