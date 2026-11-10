// Same stubs as subscription.add-subscription.spec.ts: the real modules drag
// ESM into jest.
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

// Influencers get Pro for a while in return for posts. A comp used to be
// open-ended and could only be given to an account that already existed, so
// every influencer met the plan page first and every comp had to be
// remembered and taken back by hand.

const build = (over: Record<string, any> = {}) => {
  const repository = {
    getPaymentId: jest.fn().mockResolvedValue(null),
    createOrUpdateSubscription: jest.fn().mockResolvedValue({}),
    getSubscriptionByOrgId: jest.fn().mockResolvedValue(null),
    getOrganizationByCustomerId: jest.fn().mockResolvedValue(null),
    softDeleteSubscriptionByOrg: jest.fn().mockResolvedValue({ revoked: true }),
    softDeleteExpiredComp: jest.fn().mockResolvedValue({ revoked: true }),
    releasePendingGrant: jest.fn().mockResolvedValue(undefined),
    listExpiredComps: jest.fn().mockResolvedValue([]),
    userExistsByEmail: jest.fn().mockResolvedValue(false),
    deleteOpenPendingGrantsByEmail: jest.fn().mockResolvedValue({ count: 0 }),
    createPendingGrant: jest.fn().mockImplementation(async (d) => ({ id: 'g1', ...d })),
    findOpenPendingGrant: jest.fn().mockResolvedValue(null),
    consumePendingGrant: jest.fn().mockResolvedValue(true),
    listOpenPendingGrants: jest.fn().mockResolvedValue([]),
    ...over,
  };
  const integrationService = {
    getIntegrationsList: jest.fn().mockResolvedValue([]),
    disableIntegrations: jest.fn().mockResolvedValue(undefined),
    changeActiveCron: jest.fn().mockResolvedValue(undefined),
  };
  const organizationService = {
    reconcileTeamSeats: jest.fn().mockResolvedValue(undefined),
    getOrgById: jest.fn().mockResolvedValue({ id: 'org-1', paymentId: null }),
  };
  const auditService = { record: jest.fn() };
  const service = new SubscriptionService(
    repository as any,
    integrationService as any,
    organizationService as any,
    auditService as any,
    {} as any
  );
  return { service, repository, auditService };
};

const compOf = (repository: any) =>
  repository.createOrUpdateSubscription.mock.calls[0][10];

describe('comp terms', () => {
  it('stores the reason and an end date N months ahead', async () => {
    const { service, repository } = build();
    const before = Date.now();
    await service.addSubscription('org-1', 'admin-1', 'PRO', undefined, {
      months: 3,
      reason: 'influencer',
    });
    const comp = compOf(repository);
    expect(comp.reason).toBe('influencer');
    const days = (comp.endsAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(88);
    expect(days).toBeLessThan(93);
  });

  it('without terms is open-ended compensation, as every comp was before', async () => {
    const { service, repository } = build();
    await service.addSubscription('org-1', 'admin-1', 'PRO');
    expect(compOf(repository)).toEqual({ reason: 'compensation', endsAt: null });
  });

  it.each([[2], [0], [-1], ['3']])('refuses a length of %p months and writes nothing', async (months) => {
    const { service, repository } = build();
    await expect(
      service.addSubscription('org-1', 'admin-1', 'PRO', undefined, { months: months as any })
    ).rejects.toThrow(/months/);
    expect(repository.createOrUpdateSubscription).not.toHaveBeenCalled();
  });

  it('refuses an unknown reason', async () => {
    const { service, repository } = build();
    await expect(
      service.addSubscription('org-1', 'admin-1', 'PRO', undefined, { reason: '<b>x</b>' })
    ).rejects.toThrow(/reason/);
    expect(repository.createOrUpdateSubscription).not.toHaveBeenCalled();
  });
});

describe('comp expiry', () => {
  const row = {
    organizationId: 'org-9',
    subscriptionTier: 'PRO',
    compReason: 'influencer',
    compEndsAt: new Date('2026-11-01'),
    organization: { name: 'Creator' },
  };

  it('takes back a comp past its end date, recorded as an expiry, not by a person', async () => {
    const { service, repository, auditService } = build({
      listExpiredComps: jest.fn().mockResolvedValue([row]),
    });
    const now = new Date('2026-11-10');
    const expired = await service.expireComps(now);
    expect(expired).toEqual([row]);
    expect(repository.softDeleteExpiredComp).toHaveBeenCalledWith('org-9', now);
    expect(repository.softDeleteSubscriptionByOrg).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'subscription.comp.expired',
        organizationId: 'org-9',
        userId: undefined,
      })
    );
  });

  it('a comp on an org with a Stripe customer but no subscription still ends', async () => {
    const { service, repository } = build({
      listExpiredComps: jest.fn().mockResolvedValue([row]),
      getPaymentId: jest.fn().mockResolvedValue('cus_abc'),
    });
    await expect(service.expireComps()).resolves.toHaveLength(1);
    expect(repository.softDeleteExpiredComp).toHaveBeenCalled();
  });

  // The list is read first, the revoke comes later. A comp
  // extended, or a plan bought, in between must keep its plan: the end date
  // is checked again in the write, and nothing else happens without it.
  it('keeps a plan that changed between the list and the revoke', async () => {
    const { service, repository, auditService } = build({
      listExpiredComps: jest.fn().mockResolvedValue([row]),
      softDeleteExpiredComp: jest.fn().mockResolvedValue({ revoked: false }),
    });
    await expect(service.expireComps()).resolves.toEqual([]);
    expect(repository.softDeleteSubscriptionByOrg).not.toHaveBeenCalled();
    expect(repository.createOrUpdateSubscription).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });
});

describe('a comp promised to an email', () => {
  it('is stored lower-case, replacing the one still waiting for that address', async () => {
    const { service, repository } = build();
    await service.createPendingGrant(' Creator@Example.COM ', 'PRO', { months: 6 }, 'admin-1');
    expect(repository.deleteOpenPendingGrantsByEmail).toHaveBeenCalledWith('creator@example.com');
    expect(repository.createPendingGrant).toHaveBeenCalledWith({
      email: 'creator@example.com',
      tier: 'PRO',
      months: 6,
      reason: 'influencer',
      createdById: 'admin-1',
    });
  });

  it('is refused for an address that already has an account', async () => {
    const { service, repository } = build({
      userExistsByEmail: jest.fn().mockResolvedValue(true),
    });
    await expect(
      service.createPendingGrant('a@b.co', 'PRO', {}, 'admin-1')
    ).rejects.toThrow(/already has an account/);
    expect(repository.createPendingGrant).not.toHaveBeenCalled();
  });

  it.each([['not-an-email', 'PRO'], ['a@b.co', 'FREE'], ['a@b.co', '__proto__']])(
    'is refused for %p / %p',
    async (email, tier) => {
      const { service, repository } = build();
      await expect(service.createPendingGrant(email, tier, {}, 'admin-1')).rejects.toThrow();
      expect(repository.createPendingGrant).not.toHaveBeenCalled();
    }
  );

  it('is put on the organization created at sign-up, with its terms', async () => {
    const grant = { id: 'g1', email: 'c@x.co', tier: 'PRO', months: 3, reason: 'influencer', createdById: 'admin-1' };
    const { service, repository, auditService } = build({
      findOpenPendingGrant: jest.fn().mockResolvedValue(grant),
    });
    await expect(service.applyPendingGrant('org-new', 'C@X.co')).resolves.toBe(true);
    expect(repository.findOpenPendingGrant).toHaveBeenCalledWith('c@x.co');
    expect(repository.consumePendingGrant).toHaveBeenCalledWith('g1', 'org-new');
    const call = repository.createOrUpdateSubscription.mock.calls[0];
    expect(call[4]).toBe('PRO');
    expect(call[8]).toEqual({ id: 'org-new' });
    expect(call[10].reason).toBe('influencer');
    expect(call[10].endsAt).toBeInstanceOf(Date);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subscription.pending-grant.applied', organizationId: 'org-new' })
    );
  });

  it('is given once: a second sign-up that lost the claim gets nothing', async () => {
    const { service, repository } = build({
      findOpenPendingGrant: jest.fn().mockResolvedValue({ id: 'g1', tier: 'PRO', months: null, reason: 'tester', createdById: 'a' }),
      consumePendingGrant: jest.fn().mockResolvedValue(false),
    });
    await expect(service.applyPendingGrant('org-2', 'c@x.co')).resolves.toBe(false);
    expect(repository.createOrUpdateSubscription).not.toHaveBeenCalled();
  });

  // The promise was marked used before the plan was written,
  // so a failed write left a used promise and an organization without a plan.
  it('goes back to waiting when the plan could not be written', async () => {
    const grant = { id: 'g5', email: 'c@x.co', tier: 'PRO', months: 1, reason: 'influencer', createdById: 'a' };
    const { service, repository } = build({
      findOpenPendingGrant: jest.fn().mockResolvedValue(grant),
      createOrUpdateSubscription: jest.fn().mockRejectedValue(new Error('db down')),
    });
    await expect(service.applyPendingGrant('org-5', 'c@x.co')).resolves.toBe(false);
    expect(repository.releasePendingGrant).toHaveBeenCalledWith('g5', 'org-5');
  });

  it.each([[123], [{ a: 1 }], [null]])('refuses a non-text address %p with 400', async (email) => {
    const { service, repository } = build();
    await expect(service.createPendingGrant(email as any, 'PRO', {}, 'admin-1')).rejects.toMatchObject({ status: 400 });
    expect(repository.createPendingGrant).not.toHaveBeenCalled();
  });

  it('never fails the sign-up', async () => {
    const { service } = build({
      findOpenPendingGrant: jest.fn().mockRejectedValue(new Error('db down')),
    });
    await expect(service.applyPendingGrant('org-2', 'c@x.co')).resolves.toBe(false);
  });

  it('finds the promise for the same Gmail mailbox written with other dots', async () => {
    const grant = { id: 'g2', email: 'jan.kowalski@gmail.com', tier: 'PRO', months: 1, reason: 'influencer', createdById: 'a' };
    const { service, repository } = build({
      listOpenPendingGrants: jest.fn().mockResolvedValue([grant]),
    });
    await expect(service.applyPendingGrant('org-3', 'JanKowalski@gmail.com')).resolves.toBe(true);
    expect(repository.consumePendingGrant).toHaveBeenCalledWith('g2', 'org-3');
  });

  it('does not let a +tag sign-up use up the promise for the plain address', async () => {
    const grant = { id: 'g3', email: 'creator@studio.co', tier: 'PRO', months: 1, reason: 'influencer', createdById: 'a' };
    const { service, repository } = build({
      listOpenPendingGrants: jest.fn().mockResolvedValue([grant]),
    });
    await expect(service.applyPendingGrant('org-4', 'creator+x@studio.co')).resolves.toBe(false);
    expect(repository.consumePendingGrant).not.toHaveBeenCalled();
  });

  it('does nothing without an address', async () => {
    const { service, repository } = build();
    await expect(service.applyPendingGrant('org-2', undefined)).resolves.toBe(false);
    expect(repository.findOpenPendingGrant).not.toHaveBeenCalled();
  });
});
