import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ProviderGrantsService, ProviderGrant } from './provider-grants.service';

// E2E-09-66: deleting an account destroyed our tokens, but Postra stayed in
// the person's Facebook, Google, LinkedIn and TikTok settings. A grant is the
// person's whole platform login, so it goes only when nothing left in Postra
// uses that login.

const grant = (over: Partial<ProviderGrant>): ProviderGrant => ({
  providerIdentifier: 'facebook',
  internalId: 'page-1',
  rootInternalId: 'fb-user-1',
  token: 'page-token',
  refreshToken: 'user-token',
  ...over,
});

const build = (stillConnected: string[] = []) => {
  const count = jest.fn(async ({ where }: any) =>
    where.OR.some((o: any) => stillConnected.includes(Object.values(o)[0] as string)) ? 1 : 0
  );
  const service = new ProviderGrantsService({ integration: { count, findMany: jest.fn() } } as any);
  return { service, count };
};

describe('revoking platform grants after an account is deleted', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;
  });

  it('asks Facebook to drop the permissions of the person, with their user token', async () => {
    await build().service.revokeUnused([grant({})]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v[\d.]+\/fb-user-1\/permissions\?access_token=user-token$/);
    expect(init.method).toBe('DELETE');
  });

  it('revokes one Facebook login once, even with a Page and an Instagram account on it', async () => {
    await build().service.revokeUnused([
      grant({}),
      grant({ internalId: 'page-2' }),
      grant({ providerIdentifier: 'instagram', internalId: 'ig-1' }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the grant while the same login is still connected in Postra', async () => {
    await build(['fb-user-1']).service.revokeUnused([grant({})]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the grant when it cannot tell', async () => {
    const { service, count } = build();
    count.mockRejectedValueOnce(new Error('db down'));
    await service.revokeUnused([grant({})]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses each platform’s own revoke endpoint', async () => {
    await build().service.revokeUnused([
      grant({ providerIdentifier: 'linkedin-page', rootInternalId: 'li-1', token: 'li-token' }),
      grant({ providerIdentifier: 'youtube', rootInternalId: 'g-1', token: 'g-access', refreshToken: 'g-refresh' }),
      grant({ providerIdentifier: 'tiktok', rootInternalId: null, internalId: 'tt-1', token: 'tt-token' }),
    ]);
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, String(init.body)]);
    expect(calls).toEqual([
      ['https://www.linkedin.com/oauth/v2/revoke', expect.stringContaining('token=li-token')],
      ['https://oauth2.googleapis.com/revoke', 'token=g-refresh'],
      ['https://open.tiktokapis.com/v2/oauth/revoke/', expect.stringContaining('token=tt-token')],
    ]);
  });

  it('leaves platforms without a grant to revoke alone', async () => {
    await build().service.revokeUnused([
      grant({ providerIdentifier: 'telegram' }),
      grant({ providerIdentifier: 'bluesky' }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a platform that refuses or times out does not throw', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    await expect(build().service.revokeUnused([grant({})])).resolves.toBeUndefined();
  });

  it('reads the tokens decrypted', async () => {
    jest.spyOn(AuthService, 'decryptIntegrationToken').mockImplementation((v: any) => (v ? `plain-${v}` : v));
    const findMany = jest.fn().mockResolvedValue([{ providerIdentifier: 'facebook', internalId: 'p', rootInternalId: 'u', token: 'a', refreshToken: 'b' }]);
    const service = new ProviderGrantsService({ integration: { findMany } } as any);
    expect(await service.collect(['org-1'])).toEqual([
      { providerIdentifier: 'facebook', internalId: 'p', rootInternalId: 'u', token: 'plain-a', refreshToken: 'plain-b' },
    ]);
    expect(await service.collect([])).toEqual([]);
  });

  // Codex review 10-10: LinkedIn Pages is its own OAuth app
  // (LINKEDIN_PAGE_CLIENT_ID); its token was sent with the profile app's
  // credentials and the revoke was refused.
  it('revokes a LinkedIn Page grant with the Pages app, and a profile grant with the profile app', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'profile-app';
    process.env.LINKEDIN_PAGE_CLIENT_ID = 'pages-app';
    await build().service.revokeUnused([
      grant({ providerIdentifier: 'linkedin', internalId: 'member-1', rootInternalId: null, token: 'profile-token' }),
      grant({ providerIdentifier: 'linkedin-page', internalId: 'org-9', rootInternalId: 'member-1', token: 'page-token' }),
    ]);
    const bodies = fetchMock.mock.calls.map(([, init]) => String(init.body));
    expect(bodies).toHaveLength(2);
    expect(bodies.find((b) => b.includes('token=profile-token'))).toContain('client_id=profile-app');
    expect(bodies.find((b) => b.includes('token=page-token'))).toContain('client_id=pages-app');
  });
});

