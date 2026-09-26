/**
 * E2E-05-19 — plugs. POST /integrations/<another org's channel>/plugs created
 * a plug row on that channel under the caller's org: it never runs (publishing
 * loads plugs with the owner's org) but it takes the (plugFunction,
 * integrationId) key and the owner then gets a 500 setting that plug up.
 * PUT /integrations/plugs/<unknown>/activate was a 500 on production.
 */
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));

import { NotFoundException } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

const service = (repo: any) => {
  const s = Object.create(IntegrationService.prototype) as IntegrationService;
  Object.assign(s, { _integrationRepository: repo });
  return s;
};
const body = { func: 'autoPlugPost', fields: [] } as any;

describe('plugs across orgs', () => {
  it('refuses a plug on a channel that is not this org’s, and writes nothing', async () => {
    const repo = {
      getIntegrationsByIds: jest.fn().mockResolvedValue([]),
      createOrUpdatePlug: jest.fn(),
    };
    await expect(
      service(repo).createOrUpdatePlug('org-b', 'channel-of-org-a', body)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.getIntegrationsByIds).toHaveBeenCalledWith('org-b', ['channel-of-org-a']);
    expect(repo.createOrUpdatePlug).not.toHaveBeenCalled();
  });

  it('still saves a plug on its own channel', async () => {
    const repo = {
      getIntegrationsByIds: jest.fn().mockResolvedValue([{ id: 'c1' }]),
      createOrUpdatePlug: jest.fn().mockResolvedValue({ activated: true }),
    };
    await expect(service(repo).createOrUpdatePlug('org-a', 'c1', body)).resolves.toEqual({
      activated: true,
    });
  });

  it('404s activating a plug that is not this org’s', async () => {
    const repo = { changePlugActivation: jest.fn().mockResolvedValue(null) };
    await expect(
      service(repo).changePlugActivation('org-b', 'nonexistent123', true)
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
