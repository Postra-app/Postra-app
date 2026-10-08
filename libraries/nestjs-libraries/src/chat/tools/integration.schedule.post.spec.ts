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

// The dashboard enforces posts_per_month through CheckPolicies; the agent
// tool created posts without asking, so a Starter org could pass 400. The
// counting itself (per billing month, E2E-07-34) is PostsService.postCapReached,
// tested on the stack (post-cap-window.spec.ts); here: the tool asks it with
// the plan's limit and every post of the batch.
const build = (tier: string | null, used: number) => {
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
  };
  const tool = new IntegrationSchedulePostTool(
    postsService as any,
    {} as any,
    subscriptionService as any
  ) as any;
  return { tool, postsService };
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

  // AI-8: one batch of ten at 399 of 400 went through in full.
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

// Codex: the check above runs before any post is written, so saves at once
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
});
