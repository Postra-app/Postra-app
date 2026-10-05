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
// tool created posts without asking, so a Starter org could pass 400.
const build = (tier: string | null, used: number) => {
  const postsService = { countPostsFromDay: jest.fn().mockResolvedValue(used) };
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

describe('agent post cap', () => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  beforeEach(() => (process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test'));
  afterAll(() => (process.env.STRIPE_PUBLISHABLE_KEY = key));

  it('stops a Starter org at 400 posts', async () => {
    const { tool } = build('STANDARD', 400);
    await expect(tool.postLimitReached('org-1', new Date().toISOString())).resolves.toBe(true);
  });

  // AI-8: one batch of ten at 399 of 400 went through in full.
  it('counts the whole batch, not just whether one more fits', async () => {
    const { tool } = build('STANDARD', 399);
    await expect(tool.postLimitReached('org-1', new Date().toISOString(), 10)).resolves.toBe(true);
    await expect(tool.postLimitReached('org-1', new Date().toISOString(), 1)).resolves.toBe(false);
  });

  it('lets a Starter org below the cap through', async () => {
    const { tool } = build('STANDARD', 399);
    await expect(tool.postLimitReached('org-1', new Date().toISOString())).resolves.toBe(false);
  });

  it('treats an org without a plan as FREE', async () => {
    const { tool } = build(null, 0);
    await expect(tool.postLimitReached('org-1', new Date().toISOString())).resolves.toBe(true);
  });

  it('does not count when billing is off', async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    const { tool, postsService } = build('STANDARD', 10_000);
    await expect(tool.postLimitReached('org-1', new Date().toISOString())).resolves.toBe(false);
    expect(postsService.countPostsFromDay).not.toHaveBeenCalled();
  });
});
