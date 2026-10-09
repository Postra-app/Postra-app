jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/redis/auth-context.cache', () => ({ bustAuthContextCacheForUsers: jest.fn() }));

import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';

// E2E-07-40 (Kris Company, 2026-10-09): the AI allowance month ran from the
// day the subscription was created (3 Oct), invoices from the end of the
// trial (9 Oct) — a video made in the trial counted against the first paid
// month, and "This month" would reset six days before the next invoice.
describe('the AI allowance month', () => {
  afterEach(() => jest.useRealTimers());

  const credits = async (subscription: object, now: string) => {
    jest.useFakeTimers({ now: new Date(now) });
    const getCreditsFrom = jest.fn().mockResolvedValue(1);
    const service = new SubscriptionService(
      { getCreditsFrom } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    await service.checkCredits(
      { id: 'org-1', isTrailing: false, subscription: { subscriptionTier: 'PRO', ...subscription } } as any,
      'ai_videos'
    );
    return getCreditsFrom.mock.calls[0][1].toISOString();
  };

  it('starts where Stripe bills from', async () => {
    expect(
      await credits(
        { createdAt: new Date('2026-10-03T14:08:28Z'), periodAnchor: new Date('2026-10-09T09:35:51Z') },
        '2026-10-12T10:00:00Z'
      )
    ).toBe('2026-10-09T09:35:51.000Z');
  });

  it('renews with the invoice, a month later', async () => {
    expect(
      await credits(
        { createdAt: new Date('2026-10-03T14:08:28Z'), periodAnchor: new Date('2026-10-09T09:35:51Z') },
        '2026-11-10T10:00:00Z'
      )
    ).toBe('2026-11-09T09:35:51.000Z');
  });

  it('a plan Stripe does not bill (a grant) still counts from its creation', async () => {
    expect(await credits({ createdAt: new Date('2026-10-03T14:08:28Z') }, '2026-10-12T10:00:00Z')).toBe(
      '2026-10-03T14:08:28.000Z'
    );
  });
});
