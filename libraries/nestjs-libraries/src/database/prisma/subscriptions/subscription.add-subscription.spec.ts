// Importing the service for real drags integration.manager → nostr-tools into
// the run, which is ESM and stops jest dead. Stubbing the injected modules
// keeps this a unit test of addSubscription.
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

// E2E-09-09: addSubscription opened with setCustomerId(orgId, userId), writing
// the *user's* id into organization.paymentId — the org's only handle on
// Stripe. Every later webhook for that org then matched no organization, and
// the original cus_… was gone with no copy. That method no longer exists; this
// spec is what keeps it from coming back.

const build = (paymentId: string | null) => {
  const repository = {
    getPaymentId: jest.fn().mockResolvedValue(paymentId),
    createOrUpdateSubscription: jest.fn().mockResolvedValue({}),
    getSubscriptionByOrgId: jest.fn().mockResolvedValue(null),
    getOrganizationByCustomerId: jest.fn().mockResolvedValue(null),
  };
  const integrationService = {
    getIntegrationsList: jest.fn().mockResolvedValue([]),
    disableIntegrations: jest.fn().mockResolvedValue(undefined),
    changeActiveCron: jest.fn().mockResolvedValue(undefined),
  };
  const organizationService = {
    reconcileTeamSeats: jest.fn().mockResolvedValue(undefined),
    getOrgById: jest.fn().mockResolvedValue({ id: 'org-1', paymentId }),
  };
  const auditService = { record: jest.fn() };
  const service = new SubscriptionService(
    repository as any,
    integrationService as any,
    organizationService as any,
    auditService as any,
    {} as any
  );
  return { service, repository, auditService, organizationService };
};

describe('addSubscription never touches the org handle on Stripe', () => {
  it('has no way left to write paymentId', () => {
    const { repository } = build(null);
    expect((repository as any).setCustomerId).toBeUndefined();
    expect(Object.keys(repository)).not.toContain('setCustomerId');
  });

  it('comps the org without passing a customer id at all', async () => {
    const { service, repository } = build(null);
    await service.addSubscription('org-1', 'user-1', 'STANDARD');

    const call = repository.createOrUpdateSubscription.mock.calls[0];
    expect(call[2]).toBe(''); // customerId
    expect(call[4]).toBe('STANDARD'); // billing
    expect(call[8]).toEqual({ id: 'org-1' }); // org, addressed by id
    expect(call[0]).toBe(false); // isTrailing
  });

  it('refuses an org that pays through Stripe, and writes nothing', async () => {
    const { service, repository, auditService } = build('cus_U9EdTfSreZXTPu');

    await expect(
      service.addSubscription('org-1', 'user-1', 'PRO')
    ).rejects.toThrow(/live Stripe customer/i);

    expect(repository.createOrUpdateSubscription).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('records who comped which org, on which tier', async () => {
    const { service, auditService } = build(null);
    await service.addSubscription('org-1', 'user-1', 'ULTIMATE');

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'subscription.comp',
        organizationId: 'org-1',
        userId: 'user-1',
        metadata: { tier: 'ULTIMATE' },
      })
    );
  });
});

describe('addSubscription validates the tier before the first write', () => {
  const rejected = ['GOLD', 'free', 'FREE', '__proto__', 'constructor', '', 'TEAM'];

  it.each(rejected)('refuses %p', async (tier) => {
    const { service, repository, auditService } = build(null);

    await expect(
      service.addSubscription('org-1', 'user-1', tier)
    ).rejects.toThrow(/Unknown subscription tier/i);

    expect(repository.getPaymentId).not.toHaveBeenCalled();
    expect(repository.createOrUpdateSubscription).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it.each(['STANDARD', 'PRO', 'ULTIMATE'])('accepts %p', async (tier) => {
    const { service, repository } = build(null);
    await service.addSubscription('org-1', 'user-1', tier);
    expect(repository.createOrUpdateSubscription).toHaveBeenCalled();
  });
});

describe('createOrUpdateSubscription does not swallow failures', () => {
  // A swallowed error made the Stripe webhook answer 200 with no plan
  // written, and Stripe never retried.
  it('lets a failed plan change reach the caller', async () => {
    const { service } = build(null);
    jest
      .spyOn(service, 'modifySubscription')
      .mockRejectedValue(new Error('db down'));

    await expect(
      service.createOrUpdateSubscription(false, 'u1', 'cus_1', 6, 'PRO', 'MONTHLY', null)
    ).rejects.toThrow('db down');
  });

  it('still skips a customer that is not ours', async () => {
    const { service, repository } = build(null);
    jest.spyOn(service, 'modifySubscription').mockResolvedValue(false);

    await expect(
      service.createOrUpdateSubscription(false, 'u1', 'cus_other', 6, 'PRO', 'MONTHLY', null)
    ).resolves.toEqual({});
    expect(repository.createOrUpdateSubscription).not.toHaveBeenCalled();
  });
});

// P2b #5: a tier change addressed by org (admin comp, revoke to FREE) skipped
// the platform step that the Stripe-webhook path has, so Business -> Starter
// left X and Discord running on Starter.
describe('tier change by org applies the same limits as the webhook path', () => {
  const channels = [
    { id: 'c-fb', providerIdentifier: 'facebook', disabled: false },
    { id: 'c-ig', providerIdentifier: 'instagram', disabled: false },
    { id: 'c-x', providerIdentifier: 'x', disabled: false },
    { id: 'c-dc', providerIdentifier: 'discord', disabled: false },
  ];
  const setup = () => {
    const built = build(null);
    const integrationService = (built.service as any)._integrationService;
    integrationService.getIntegrationsList = jest.fn().mockResolvedValue(channels);
    integrationService.disableChannel = jest.fn().mockResolvedValue(undefined);
    return { ...built, integrationService };
  };

  it('Business -> Starter disables the platforms Starter does not include', async () => {
    const { service, integrationService, organizationService } = setup();
    await service.modifySubscriptionByOrg('org-1', 3, 'STANDARD');

    const disabled = integrationService.disableChannel.mock.calls.map((c: any[]) => c[1]);
    expect(disabled).toEqual(expect.arrayContaining(['c-x', 'c-dc']));
    expect(disabled).not.toContain('c-fb');
    expect(organizationService.reconcileTeamSeats).toHaveBeenCalledWith('org-1', 1);
  });

  it('webhook path and by-org path disable the same channels', async () => {
    const byOrg = setup();
    await byOrg.service.modifySubscriptionByOrg('org-1', 3, 'STANDARD');

    const byCustomer = setup();
    byCustomer.repository.getOrganizationByCustomerId = jest.fn().mockResolvedValue({ id: 'org-1' });
    (byCustomer.repository as any).getSubscriptionByCustomerId = jest.fn().mockResolvedValue(null);
    await byCustomer.service.modifySubscription('cus_1', 3, 'STANDARD');

    expect(byOrg.integrationService.disableChannel.mock.calls).toEqual(
      byCustomer.integrationService.disableChannel.mock.calls
    );
  });
});
