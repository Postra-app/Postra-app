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

// A plan Apple bills is kept in step by Apple's notifications. A comp or a
// revoke from the admin panel would be overwritten at the next renewal, with
// the customer still paying Apple.
const build = (current: any, ended = { revoked: true }) => {
  const repository = {
    getPaymentId: jest.fn().mockResolvedValue(null),
    createOrUpdateSubscription: jest.fn().mockResolvedValue({}),
    getSubscriptionByOrgId: jest.fn().mockResolvedValue(current),
    softDeleteSubscriptionByOrg: jest.fn().mockResolvedValue({ revoked: true }),
    endAppleSubscription: jest.fn().mockResolvedValue(ended),
    getOrganizationByCustomerId: jest.fn().mockResolvedValue(null),
  };
  const integrationService = {
    getIntegrationsList: jest.fn().mockResolvedValue([]),
    disableIntegrations: jest.fn().mockResolvedValue(undefined),
    changeActiveCron: jest.fn().mockResolvedValue(undefined),
  };
  const organizationService = {
    reconcileTeamSeats: jest.fn().mockResolvedValue(undefined),
    getOrgById: jest.fn().mockResolvedValue({ id: 'org-1', paymentId: null }),
    getTeam: jest.fn().mockResolvedValue({ users: [] }),
  };
  const auditService = { record: jest.fn() };
  const service = new SubscriptionService(
    repository as any,
    integrationService as any,
    organizationService as any,
    auditService as any,
    {} as any
  );
  return { service, repository, auditService, integrationService };
};

const APPLE = { id: 'sub-1', totalChannels: 8, appleOriginalTransactionId: '2000000000000001' };

describe('a plan billed by Apple', () => {
  it('cannot be comped over from the admin panel', async () => {
    const { service, repository } = build(APPLE);
    await expect(service.addSubscription('org-1', 'admin-1', 'PRO')).rejects.toMatchObject({
      status: 400,
    });
    expect(repository.createOrUpdateSubscription).not.toHaveBeenCalled();
  });

  it('cannot be revoked from the admin panel', async () => {
    const { service, repository } = build(APPLE);
    await expect(service.revokeSubscription('org-1', 'admin-1')).rejects.toMatchObject({
      status: 400,
    });
    expect(repository.softDeleteSubscriptionByOrg).not.toHaveBeenCalled();
  });

  it('a comp on an organisation without one is still granted', async () => {
    const { service, repository } = build(null);
    await service.addSubscription('org-1', 'admin-1', 'PRO');
    expect(repository.createOrUpdateSubscription).toHaveBeenCalledTimes(1);
    // A write that is not Apple's carries no purchase, which clears the columns.
    expect(repository.createOrUpdateSubscription.mock.calls[0][11]).toBeUndefined();
  });

  it('ending it sends the organisation back to the free tier and records it', async () => {
    const { service, repository, auditService, integrationService } = build(APPLE);
    const at = new Date();
    await expect(service.endAppleSubscription('org-1', APPLE.appleOriginalTransactionId, at)).resolves.toEqual({
      revoked: true,
    });
    expect(repository.endAppleSubscription).toHaveBeenCalledWith('org-1', APPLE.appleOriginalTransactionId, at);
    expect(integrationService.getIntegrationsList).toHaveBeenCalledWith('org-1');
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subscription.apple.ended', organizationId: 'org-1' })
    );
  });

  it('ending a purchase whose plan was since replaced changes nothing', async () => {
    const { service, auditService, integrationService } = build(APPLE, { revoked: false });
    await service.endAppleSubscription('org-1', 'other', new Date());
    expect(integrationService.getIntegrationsList).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });
});
