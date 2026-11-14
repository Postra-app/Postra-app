jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service', () => ({ OAuthService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/lacks.subscription', () => ({ lacksSubscription: () => false }));

import { PublicAuthMiddleware } from './public.auth.middleware';

// `Authorization: Bearer <key>` is the default of every HTTP client and agent
// tool, and /mcp takes it; public/v1 answered 401 "Invalid API key" because
// the prefix went into the key lookup (upstream #1990).
describe('public/v1 authorization header', () => {
  const run = async (authorization?: string) => {
    const getOrgByApiKey = jest.fn(async (key: string) => (key === 'api-key-1' ? { id: 'org-1' } : null));
    const getOrgByOAuthToken = jest.fn(async (token: string) =>
      token === 'pos_token' ? { organization: { id: 'org-2' } } : null
    );
    const middleware = new PublicAuthMiddleware({ getOrgByApiKey } as any, { getOrgByOAuthToken } as any);
    const req: any = { headers: authorization === undefined ? {} : { authorization } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await middleware.use(req, res, next);
    return { org: req.org?.id, status: res.status.mock.calls[0]?.[0], passed: next.mock.calls.length === 1 };
  };

  it('takes the key with and without "Bearer "', async () => {
    expect(await run('api-key-1')).toMatchObject({ org: 'org-1', passed: true });
    expect(await run('Bearer api-key-1')).toMatchObject({ org: 'org-1', passed: true });
    expect(await run('bearer   api-key-1')).toMatchObject({ org: 'org-1', passed: true });
  });

  it('takes an OAuth token with "Bearer " as an OAuth token', async () => {
    expect(await run('Bearer pos_token')).toMatchObject({ org: 'org-2', passed: true });
    expect(await run('pos_token')).toMatchObject({ org: 'org-2', passed: true });
  });

  it('still refuses a wrong key and a missing or empty header', async () => {
    expect(await run('Bearer nope')).toMatchObject({ status: 401, passed: false });
    expect(await run('Bearer ')).toMatchObject({ status: 401, passed: false });
    expect(await run()).toMatchObject({ status: 401, passed: false });
  });
});
