jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/redis/auth-context.cache', () => ({
  bustAuthContextCacheForUsers: jest.fn().mockResolvedValue(undefined),
}));

import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';

// A lapsed trial or cancelled plan drops the org to FREE and disables its
// channels; paying again left them all disabled (upstream 4a6ba07f, c145f0c3).
// Postra plans are per platform, so only channels the new plan covers come back.

type Channel = { id: string; providerIdentifier: string; disabled: boolean };
const ch = (id: string, providerIdentifier: string, disabled = true): Channel => ({
  id,
  providerIdentifier,
  disabled,
});

const build = (channels: Channel[], current: { totalChannels: number } | null) => {
  const repository = {
    getOrganizationByCustomerId: jest.fn().mockResolvedValue({ id: 'org-1' }),
    getSubscriptionByCustomerId: jest.fn().mockResolvedValue(current),
    getSubscriptionByOrgId: jest.fn().mockResolvedValue(current),
    createOrUpdateSubscription: jest.fn().mockResolvedValue({}),
  };
  const integrationService = {
    getIntegrationsList: jest.fn().mockResolvedValue(channels),
    disableIntegrations: jest.fn().mockResolvedValue(undefined),
    disableChannel: jest.fn().mockResolvedValue(undefined),
    enableChannels: jest.fn().mockResolvedValue(undefined),
    changeActiveCron: jest.fn().mockResolvedValue(undefined),
  };
  const organizationService = {
    reconcileTeamSeats: jest.fn().mockResolvedValue(undefined),
    getOrgById: jest.fn(),
  };
  const service = new SubscriptionService(
    repository as any,
    integrationService as any,
    organizationService as any,
    { record: jest.fn() } as any,
    {} as any
  );
  return { service, integrationService };
};

const subscribe = (
  service: SubscriptionService,
  billing: 'STANDARD' | 'PRO' | 'ULTIMATE',
  totalChannels: number,
  isTrailing = false
) =>
  service.createOrUpdateSubscription(
    isTrailing,
    'sub_1',
    'cus_1',
    totalChannels,
    billing,
    'MONTHLY',
    null
  );

describe('channels after paying again', () => {
  it('a lapsed org buying Pro gets its channels back', async () => {
    const { service, integrationService } = build(
      [ch('fb', 'facebook'), ch('yt', 'youtube'), ch('li', 'linkedin', false)],
      null
    );
    await subscribe(service, 'PRO', 6);
    expect(integrationService.enableChannels).toHaveBeenCalledWith('org-1', ['fb', 'yt']);
  });

  it('a platform the plan does not cover stays off', async () => {
    const { service, integrationService } = build(
      [ch('fb', 'facebook'), ch('x', 'x'), ch('dc', 'discord')],
      null
    );
    await subscribe(service, 'STANDARD', 3);
    expect(integrationService.enableChannels).toHaveBeenCalledWith('org-1', ['fb']);
  });

  it('a renewal on the same limit leaves channels the user disabled alone', async () => {
    const { service, integrationService } = build(
      [ch('fb', 'facebook'), ch('ig', 'instagram', false)],
      { totalChannels: 6 }
    );
    await subscribe(service, 'PRO', 6);
    expect(integrationService.enableChannels).not.toHaveBeenCalled();
  });

  it('nothing comes back when the covered channels do not all fit', async () => {
    const { service, integrationService } = build(
      ['facebook', 'instagram', 'tiktok', 'linkedin'].map((p) => ch(p, p)),
      null
    );
    await subscribe(service, 'STANDARD', 3);
    expect(integrationService.enableChannels).not.toHaveBeenCalled();
  });

  it('a trial counts its own cap, not the plan limit', async () => {
    const { service, integrationService } = build(
      ['facebook', 'instagram', 'tiktok', 'linkedin'].map((p) => ch(p, p)),
      null
    );
    await subscribe(service, 'ULTIMATE', 12, true);
    expect(integrationService.enableChannels).not.toHaveBeenCalled();
  });

  it('an upgrade from a smaller plan enables what now fits', async () => {
    const { service, integrationService } = build(
      [ch('fb', 'facebook', false), ch('ig', 'instagram'), ch('yt', 'youtube')],
      { totalChannels: 3 }
    );
    await subscribe(service, 'PRO', 6);
    expect(integrationService.enableChannels).toHaveBeenCalledWith('org-1', ['ig', 'yt']);
  });
});
