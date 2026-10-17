jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { PermissionsService } from './permissions.service';
import { AuthorizationActions, Sections } from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';

// K. 2026-10-16: a 7-day trial is held to 30 posts a month, 1 person,
// 1 webhook and 1 Auto Post feed, whatever plan it runs on. Before, a
// Business trial had 10 000 webhooks, 10 feeds, 5 seats and unlimited posts.
describe('a trial on Business', () => {
  const build = ({ trialing }: { trialing: boolean }) => {
    const postCapReached = jest.fn().mockResolvedValue(false);
    const subscription = {
      subscriptionTier: 'ULTIMATE',
      totalChannels: 12,
      createdAt: new Date('2026-10-10T10:00:00Z'),
      periodAnchor: null as Date | null,
    };
    const service = new PermissionsService(
      {
        getSubscriptionByOrganizationId: jest.fn().mockResolvedValue(subscription),
        getSubscription: jest.fn().mockResolvedValue(subscription),
      } as any,
      { postCapReached } as any,
      {} as any,
      // one webhook, one feed and the owner already there
      { getTotal: jest.fn().mockResolvedValue(1) } as any,
      { getTotal: jest.fn().mockResolvedValue(1) } as any,
      {
        getActiveMemberCount: jest.fn().mockResolvedValue(1),
        getOrgById: jest.fn().mockResolvedValue({ isTrailing: trialing }),
      } as any
    );
    return { service, postCapReached };
  };
  const can = async (trialing: boolean, section: Sections) => {
    const { service } = build({ trialing });
    const ability = await service.check('org-1', new Date(), 'SUPERADMIN', [[AuthorizationActions.Create, section]], undefined, trialing);
    return ability.can(AuthorizationActions.Create, section);
  };

  beforeAll(() => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
  });

  it('cannot add a second webhook, a second feed or a team member', async () => {
    for (const section of [Sections.WEBHOOKS, Sections.AUTOPOST, Sections.TEAM_MEMBERS]) {
      expect([section, await can(true, section)]).toEqual([section, false]);
    }
  });

  it('while the paid plan can', async () => {
    for (const section of [Sections.WEBHOOKS, Sections.AUTOPOST, Sections.TEAM_MEMBERS]) {
      expect([section, await can(false, section)]).toEqual([section, true]);
    }
  });

  it('counts posts against 30 a month', async () => {
    const { service, postCapReached } = build({ trialing: true });
    await service.check('org-1', new Date(), 'SUPERADMIN', [[AuthorizationActions.Create, Sections.POSTS_PER_MONTH]], undefined, true);
    expect(postCapReached.mock.calls[0][2]).toBe(30);
  });

  it('and where a post is written, looking the trial up when not told', async () => {
    const { service } = build({ trialing: true });
    expect((await service.postCap('org-1', new Date()))?.limit).toBe(30);
    expect((await service.postCap('org-1', new Date(), false))?.limit).toBe(1000000);
  });
});
