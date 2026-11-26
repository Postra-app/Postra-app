jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { BillingController } from './billing.controller';

// During the trial the customer sees how much of it is left, in
// numbers ("Channels 1 / 2 · Posts 4 / 15 · AI images 3 / 10 · 3 days left").
describe('GET /billing/trial', () => {
  const build = (status: unknown = { endsAt: 5_000, hasCard: false }) => {
    const subscriptionService = {
      postCap: jest.fn().mockResolvedValue({ anchor: new Date(0), limit: 15 }),
      checkCredits: jest.fn().mockResolvedValue({ credits: 7 }),
    };
    const stripeService = { trialStatus: jest.fn().mockResolvedValue(status) };
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
      channels: { used: 1, limit: 2 },
      posts: { used: 4, limit: 15 },
      images: { used: 3, limit: 10 },
    });
  });

  it('no trial, no bar, and Stripe is not asked', async () => {
    const { controller, stripeService } = build();

    expect(await controller.trial({ ...org, isTrailing: false })).toEqual({ trial: false });
    expect(stripeService.trialStatus).not.toHaveBeenCalled();
  });

  it('a trial Stripe no longer has shows no bar', async () => {
    const { controller } = build(null);

    expect(await controller.trial(org)).toEqual({ trial: false });
  });
});
