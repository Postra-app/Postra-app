jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { PermissionsService } from './permissions.service';
import { AuthorizationActions, Sections } from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';

// Same as E2E-07-40 for the monthly post allowance (Starter: 400): it ran
// from the day the subscription was created, invoices from Stripe's billing
// anchor (found in the Pro limits check of Kris Company, 2026-10-09).
describe('the monthly post allowance', () => {
  const anchor = new Date('2026-10-09T09:35:51Z');
  const build = () => {
    const postCapReached = jest.fn().mockResolvedValue(false);
    const subscription = {
      subscriptionTier: 'STANDARD',
      totalChannels: 3,
      createdAt: new Date('2026-10-03T14:08:28Z'),
      periodAnchor: anchor,
    };
    const service = new PermissionsService(
      {
        getSubscriptionByOrganizationId: jest.fn().mockResolvedValue(subscription),
        getSubscription: jest.fn().mockResolvedValue(subscription),
      } as any,
      { postCapReached } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { service, postCapReached };
  };

  beforeAll(() => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
  });

  it('counts from Stripe’s billing anchor when posting', async () => {
    const { service, postCapReached } = build();
    await service.check('org-1', new Date(), 'SUPERADMIN', [[AuthorizationActions.Create, Sections.POSTS_PER_MONTH]]);
    expect(postCapReached.mock.calls[0][1]).toEqual(anchor);
  });

  it('and where a post is written', async () => {
    const { service } = build();
    expect((await service.postCap('org-1', new Date()))?.anchor).toEqual(anchor);
  });
});
