/**
 * E2E-05-23 — production has no link shortener configured (no Dub, Short.io,
 * Kutt or LinkDrip keys), yet Settings offered "Always shortlink", which does
 * nothing there. The preference now says whether a shortener exists.
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
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));

import { SettingsController } from './settings.controller';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';

const controller = () => {
  const c = Object.create(SettingsController.prototype) as SettingsController;
  Object.assign(c, {
    _organizationService: {
      getShortlinkPreference: jest.fn().mockResolvedValue({ shortlink: 'ASK' }),
    },
  });
  return c;
};

describe('GET /settings/shortlink', () => {
  const original = ShortLinkService.provider;
  afterEach(() => {
    ShortLinkService.provider = original;
  });

  it('says unavailable when no shortener is configured', async () => {
    ShortLinkService.provider = { shortLinkDomain: 'empty' } as any;
    await expect(controller().getShortlinkPreference({ id: 'o' } as any)).resolves.toEqual({
      shortlink: 'ASK',
      available: false,
    });
  });

  it('says available when one is', async () => {
    ShortLinkService.provider = { shortLinkDomain: 'dub.sh' } as any;
    const out = await controller().getShortlinkPreference({ id: 'o' } as any);
    expect(out.available).toBe(true);
  });
});
