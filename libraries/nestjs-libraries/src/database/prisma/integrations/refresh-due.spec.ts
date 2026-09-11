jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

/**
 * `needsToBeRefreshed` selects `tokenExpiration <= now + 24h`, and the command
 * printed that count as "N channel(s) due". For YouTube, whose access token
 * lives about an hour, and TikTok, whose token lives 23 hours, that condition
 * is the permanent steady state — those refresh reactively on a 401 during
 * publishing. Measured on production: `3 channel(s) due`, which reads as an
 * incident and is not one (E2E-09-59).
 *
 * The number an operator has to act on is a token that is *already* expired on
 * a channel no scheduled workflow watches. `refreshCron` is what puts a channel
 * under `refreshTokenWorkflow`, and only instagram-standalone, threads and whop
 * declare it.
 */
const build = (integrations: any[], providers: Record<string, any> = {}) => {
  const repository = {
    needsToBeRefreshed: jest.fn(async () => integrations),
  };
  const manager = {
    getSocialIntegration: jest.fn((id: string) => providers[id] ?? {}),
  };

  const service = new IntegrationService(
    repository as any,
    {} as any, // autoposts
    manager as any,
    {} as any, // notifications
    {} as any, // refresh integrations
    {} as any, // temporal
    {} as any // audit
  );

  return { service, repository, manager };
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000);
const hoursAhead = (h: number) => new Date(Date.now() + h * 3600 * 1000);

describe('refreshTokens dry-run reporting', () => {
  it('does not call a provider or write anything', async () => {
    const { service, manager } = build([
      {
        id: 'i1',
        name: 'Channel',
        providerIdentifier: 'tiktok',
        tokenExpiration: hoursAhead(20),
        refreshToken: 'enc::x',
      },
    ]);

    const result = await service.refreshTokens(false);

    expect(result.total).toBe(1);
    expect(result.refreshed).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    // Only looked up to report whether it is on a schedule.
    expect(manager.getSocialIntegration).toHaveBeenCalledWith('tiktok');
  });

  it('reports a token expiring soon as not yet overdue', async () => {
    const { service } = build([
      {
        id: 'i1',
        name: 'YouTube channel',
        providerIdentifier: 'youtube',
        tokenExpiration: hoursAhead(1),
        refreshToken: 'enc::x',
      },
    ]);

    const [channel] = (await service.refreshTokens(false)).refreshed;

    expect(channel.expiredFor).toBe(0);
  });

  it('says how long an expired token has been expired', async () => {
    const { service } = build([
      {
        id: 'i1',
        name: 'YouTube channel',
        providerIdentifier: 'youtube',
        tokenExpiration: hoursAgo(5),
        refreshToken: 'enc::x',
      },
    ]);

    const [channel] = (await service.refreshTokens(false)).refreshed;

    expect(channel.expiredFor).toBeGreaterThan(4 * 3600);
    expect(channel.expiredFor).toBeLessThan(6 * 3600);
  });

  it('separates a channel on a scheduled refresh from one that is not', async () => {
    const { service } = build(
      [
        {
          id: 'i1',
          name: 'Threads',
          providerIdentifier: 'threads',
          tokenExpiration: hoursAgo(2),
          refreshToken: 'enc::x',
        },
        {
          id: 'i2',
          name: 'TikTok',
          providerIdentifier: 'tiktok',
          tokenExpiration: hoursAgo(2),
          refreshToken: 'enc::x',
        },
      ],
      { threads: { refreshCron: true }, tiktok: {} }
    );

    const { refreshed } = await service.refreshTokens(false);

    expect(refreshed.find((c) => c.provider === 'threads')?.scheduled).toBe(
      true
    );
    expect(refreshed.find((c) => c.provider === 'tiktok')?.scheduled).toBe(
      false
    );
  });

  it('treats a channel with no expiry as not expired', async () => {
    // Facebook, Instagram through Facebook, X and Telegram report expiresIn: 0
    // at connect time, so tokenExpiration stays NULL and the predicate never
    // returns them at all. If one ever arrives here, it is not overdue.
    const { service } = build([
      {
        id: 'i1',
        name: 'Page',
        providerIdentifier: 'facebook',
        tokenExpiration: null,
        refreshToken: 'enc::x',
      },
    ]);

    const [channel] = (await service.refreshTokens(false)).refreshed;

    expect(channel.expiredFor).toBe(0);
  });
});
