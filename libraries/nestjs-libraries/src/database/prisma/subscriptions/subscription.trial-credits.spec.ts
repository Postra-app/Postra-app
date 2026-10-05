jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/redis/auth-context.cache', () => ({ bustAuthContextCacheForUsers: jest.fn() }));

import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// E2E-07-21 (BILL-8): images generated in the background (Creator, Auto Post)
// were counted against the full Business pool during a trial — the trial
// flag never reached the enforcement.
describe('background image generation during a trial', () => {
  beforeAll(() => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
  });

  it('is held to the trial allowance, not the plan pool', async () => {
    const useCredit = jest.fn(async (_org: unknown, _type: string, fn: () => Promise<unknown>) => fn());
    const service = new SubscriptionService(
      {
        getSubscriptionByOrgId: async () => ({ subscriptionTier: 'ULTIMATE', createdAt: new Date() }),
        useCredit,
      } as any,
      {} as any,
      { getOrgById: async () => ({ id: 'org-1', isTrailing: true }) } as any,
      {} as any,
      {} as any
    );
    await service.useCreditByOrgId('org-1', 'ai_images', async () => 'ok');
    const enforcement = useCredit.mock.calls[0][3] as { limit: number };
    expect(enforcement.limit).toBeLessThan(pricing.ULTIMATE.image_generation_count);
  });
});
