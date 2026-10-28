// Importing the real services drags integration.manager → nostr-tools (ESM).
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);

import { IntegrationSchedulePostTool } from './integration.schedule.post';
import { postAllowance } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// The dashboard enforces posts_per_month through CheckPolicies; the agent
// tool created posts without asking, so a Starter org could pass 400. The
// counting itself (per billing month) is PostsService.postCapReached,
// tested on the stack (post-cap-window.spec.ts); here: the tool asks it with
// the plan's limit and every post of the batch.
const build = (tier: string | null, used: number, trialing = false) => {
  const postsService = {
    postCapReached: jest.fn(
      async (_org: string, _anchor: unknown, limit: number, posts: unknown[]) =>
        used + posts.length > limit
    ),
  };
  const subscriptionService = {
    getSubscription: jest
      .fn()
      .mockResolvedValue(
        tier ? { subscriptionTier: tier, createdAt: new Date() } : null
      ),
    isTrailing: jest.fn().mockResolvedValue(trialing),
    // SubscriptionService.postCap, over the mocks above.
    postCap: async (orgId: string, orgCreatedAt: string) =>
      process.env.STRIPE_PUBLISHABLE_KEY
        ? postAllowance(
            await subscriptionService.getSubscription(orgId),
            orgCreatedAt,
            await subscriptionService.isTrailing(orgId)
          )
        : undefined,
  };
  const tool = new IntegrationSchedulePostTool(
    postsService as any,
    {} as any,
    subscriptionService as any
  ) as any;
  return { tool, postsService, subscriptionService };
};
const posts = (n: number) => Array.from({ length: n }, () => ({}));

describe('agent post cap', () => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  beforeEach(() => (process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test'));
  afterAll(() => (process.env.STRIPE_PUBLISHABLE_KEY = key));

  it('stops a Starter org at 400 posts', async () => {
    const { tool, postsService } = build('STANDARD', 400);
    await expect(tool.postLimitReached('org-1', new Date().toISOString(), posts(1))).resolves.toBe(true);
    expect(postsService.postCapReached.mock.calls[0][2]).toBe(400);
  });

  // A trial posts at most 30 a month, whatever the plan.
  it('stops a Business trial at 30 posts, like the app', async () => {
    const { tool, postsService } = build('ULTIMATE', 30, true);
    await expect(tool.postLimitReached('org-1', new Date().toISOString(), posts(1))).resolves.toBe(true);
    expect(postsService.postCapReached.mock.calls[0][2]).toBe(30);
  });

  // One batch of ten at 399 of 400 went through in full.
  it('counts the whole batch, not just whether one more fits', async () => {
    const { tool } = build('STANDARD', 399);
    await expect(tool.postLimitReached('org-1', new Date().toISOString(), posts(10))).resolves.toBe(true);
    await expect(tool.postLimitReached('org-1', new Date().toISOString(), posts(1))).resolves.toBe(false);
  });

  it('lets a Starter org below the cap through', async () => {
    const { tool } = build('STANDARD', 399);
    await expect(tool.postLimitReached('org-1', new Date().toISOString(), posts(1))).resolves.toBe(false);
  });

  it('treats an org without a plan as FREE', async () => {
    const { tool } = build(null, 0);
    await expect(tool.postLimitReached('org-1', new Date().toISOString(), posts(1))).resolves.toBe(true);
  });

  it('does not count when billing is off', async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    const { tool, postsService } = build('STANDARD', 10_000);
    await expect(tool.postLimitReached('org-1', new Date().toISOString(), posts(1))).resolves.toBe(false);
    expect(postsService.postCapReached).not.toHaveBeenCalled();
  });
});

// The check above runs before any post is written, so saves at once
// could all pass it. createPost counts again behind a lock with this cap.
describe('agent post cap passed to createPost', () => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  afterAll(() => (process.env.STRIPE_PUBLISHABLE_KEY = key));

  it("is the plan's monthly posts from the subscription's start", async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    const { tool } = build('STANDARD', 0);
    const cap = await tool.postCap('org-1', new Date(0).toISOString());
    expect(cap.limit).toBe(400);
    expect(cap.anchor).toBeInstanceOf(Date);
  });

  it('is none when billing is off', async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    const { tool } = build('STANDARD', 0);
    await expect(tool.postCap('org-1', new Date().toISOString())).resolves.toBeUndefined();
  });

  // The dashboard and the public API count the
  // month from Stripe's billing anchor; the agent still counted
  // from the subscription's creation, a week off after a trial.
  it("counts the month from Stripe's billing anchor, like the dashboard", async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    const { tool, subscriptionService } = build('STANDARD', 0);
    const createdAt = new Date('2026-10-03T14:08:54Z');
    const periodAnchor = new Date('2026-10-09T09:35:51Z');
    subscriptionService.getSubscription.mockResolvedValue({ subscriptionTier: 'STANDARD', createdAt, periodAnchor });
    expect((await tool.postCap('org-1', new Date(0).toISOString())).anchor).toEqual(periodAnchor);
    subscriptionService.getSubscription.mockResolvedValue({ subscriptionTier: 'STANDARD', createdAt, periodAnchor: null });
    expect((await tool.postCap('org-1', new Date(0).toISOString())).anchor).toEqual(createdAt);
  });
});
