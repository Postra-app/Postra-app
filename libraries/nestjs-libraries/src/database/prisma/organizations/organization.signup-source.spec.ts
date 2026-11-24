jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { OrganizationRepository } from './organization.repository';

// A new organisation remembers the campaign its sign-up came from, as short
// labels. The values are cleaned at the last step before the database, so a
// caller that skipped the request validation cannot store anything else.
describe('a new organisation keeps the campaign it signed up from', () => {
  const created = async (extra: object) => {
    const create = jest.fn().mockResolvedValue({ id: 'org-1', users: [] });
    const repo = new OrganizationRepository(
      { model: { organization: { create } } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    await repo.createOrgAndUser(
      {
        company: 'Example Ltd',
        email: 'owner@example.com',
        password: '',
        provider: 'GOOGLE',
        providerId: 'g-1',
        termsAccepted: true,
        datafast_visitor_id: '',
        ...extra,
      } as any,
      true,
      '1.2.3.4',
      'ua'
    );
    return create.mock.calls[0][0].data;
  };

  it('stores the three values', async () => {
    const data = await created({
      signupSource: 'facebook',
      signupMedium: 'cpc',
      signupCampaign: 'launch-week',
    });
    expect(data).toMatchObject({
      signupSource: 'facebook',
      signupMedium: 'cpc',
      signupCampaign: 'launch-week',
    });
  });

  it('lower-cases, and leaves out a value that is not a short label', async () => {
    const data = await created({
      signupSource: ' Facebook ',
      signupMedium: 'https://example.com/?fbclid=abc',
      signupCampaign: 'x'.repeat(65),
    });
    expect(data.signupSource).toBe('facebook');
    expect(data).not.toHaveProperty('signupMedium');
    expect(data).not.toHaveProperty('signupCampaign');
  });

  it('stores nothing for a sign-up without a campaign', async () => {
    const data = await created({});
    expect(data).not.toHaveProperty('signupSource');
    expect(data).not.toHaveProperty('signupMedium');
    expect(data).not.toHaveProperty('signupCampaign');
    expect(data.name).toBe('Example Ltd');
  });
});
