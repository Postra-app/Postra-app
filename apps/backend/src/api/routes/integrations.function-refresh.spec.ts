import 'reflect-metadata';

jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { IntegrationsController } = require('./integrations.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RefreshToken } = require('@gitroom/nestjs-libraries/integrations/social.abstract');

// Codex review of E2E-08-63: TikTok creator info now raises RefreshToken on a
// 401. When the platform refused the refreshed token too, the route refreshed
// and called itself again with no limit, so the composer never got an answer.
describe('POST /integrations/function after a token refresh', () => {
  const org = { id: 'org-1' } as any;

  const setup = (refusals: number) => {
    let calls = 0;
    const provider = {
      async creatorInfo() {
        calls++;
        if (calls <= refusals) {
          throw new RefreshToken('tiktok', '{"error":{"code":"access_token_invalid"}}', '{}', 'expired');
        }
        return { privacyOptions: ['SELF_ONLY'] };
      },
    };
    const refresh = jest.fn(async () => ({ accessToken: 'fresh' }));
    const controller = new IntegrationsController(
      { getSocialIntegration: () => provider } as any,
      {
        getIntegrationById: async () => ({ token: 'old', internalId: 'tt-1', providerIdentifier: 'tiktok' }),
      } as any,
      {} as any,
      { refresh } as any
    );
    return { controller, refresh, calls: () => calls };
  };

  it('retries once with the refreshed token', async () => {
    const { controller, refresh, calls } = setup(1);
    await expect(controller.functionIntegration(org, { id: 'tt-1', name: 'creatorInfo' })).resolves.toEqual({
      privacyOptions: ['SELF_ONLY'],
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls()).toBe(2);
  });

  it('gives up when the refreshed token is refused too', async () => {
    const { controller, refresh, calls } = setup(5);
    await expect(controller.functionIntegration(org, { id: 'tt-1', name: 'creatorInfo' })).resolves.toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls()).toBe(2);
  });
});
