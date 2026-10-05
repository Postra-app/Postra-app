import { OAuthRepository } from './oauth.repository';
import { OrganizationRepository } from '../organizations/organization.repository';

// API-7: checkCredits starts the cycle at subscription.createdAt, which the
// public API and MCP never loaded — the cycle started at the time of the
// request.
it('the API key and OAuth token lookups load the subscription start', async () => {
  const findFirst = jest.fn().mockResolvedValue(null);
  const orgs = new OrganizationRepository({ model: { organization: { findFirst } } } as any, {} as any, {} as any, {} as any, {} as any);
  await orgs.getOrgByApiKey('key');
  expect(findFirst.mock.calls[0][0].include.subscription.select.createdAt).toBe(true);

  const authFindFirst = jest.fn().mockResolvedValue(null);
  const oauth = new (OAuthRepository as any)(...Array.from({ length: 4 }, () => ({ model: { oAuthAuthorization: { findFirst: authFindFirst } } })));
  await oauth.findByAccessToken('token');
  expect(authFindFirst.mock.calls[0][0].include.organization.include.subscription.select.createdAt).toBe(true);
});
