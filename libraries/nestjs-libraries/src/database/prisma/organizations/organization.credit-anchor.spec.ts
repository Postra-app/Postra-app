jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { OrganizationRepository } from './organization.repository';

// E2E-07-40 (Codex): the organisation the session carries is what the app's
// AI credit checks read. Its subscription lacked periodAnchor (and, when
// impersonating, createdAt), so the app counted credits differently from the
// public API and the admin reset.
describe('the session organisation carries the credit period fields', () => {
  const selects = async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const findFirst = jest.fn().mockResolvedValue(null);
    const repo = new OrganizationRepository(
      { model: { organization: { findMany, findFirst } } } as any,
      { model: { userOrganization: { findFirst } } } as any,
      {} as any,
      {} as any
    );
    await repo.getOrgsByUserId('user-1');
    await repo.getUserOrg('membership-1');
    return [findMany.mock.calls[0][0], findFirst.mock.calls[0][0]];
  };

  it('in the normal session and when impersonating', async () => {
    const [orgs, impersonated] = await selects();
    const sub = (q: any) => JSON.stringify(q).match(/"subscription":\{"select":(\{[^}]*\})/)?.[1] || '';
    expect(sub(orgs)).toContain('"periodAnchor":true');
    expect(sub(orgs)).toContain('"createdAt":true');
    expect(sub(impersonated)).toContain('"periodAnchor":true');
    expect(sub(impersonated)).toContain('"createdAt":true');
  });
});
