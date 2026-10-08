jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';

// A new channel gets three posting times shifted by the browser's UTC offset.
// An offset of 0 — the UK in winter — was taken as "no offset given", and the
// channel got the schema defaults 02:00, 06:40 and 11:40 (docs P3 check,
// 2026-10-09).
describe('posting times of a new channel', () => {
  const connect = async (timezone?: number) => {
    const upsert = jest.fn().mockResolvedValue({ id: 'int-1', providerIdentifier: 'bluesky' });
    const integration = { upsert, findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn() };
    const repository = new IntegrationRepository({ model: { integration } } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await repository.createOrUpdateIntegration(undefined, true, 'org-1', 'Channel', undefined, 'social', 'int-1', 'bluesky', 'token', '', 3600, 'user', false, undefined, timezone);
    const times = upsert.mock.calls[0][0].create.postingTimes;
    return times ? JSON.parse(times).map((t: { time: number }) => t.time) : undefined;
  };

  it('uses the times for a UTC offset of 0 (the UK in winter)', async () => {
    expect(await connect(0)).toEqual([560, 850, 1140]);
  });

  it('shifts them for a summer offset', async () => {
    expect(await connect(60)).toEqual([500, 790, 1080]);
  });

  it('leaves the defaults when no offset came with the request', async () => {
    expect(await connect(undefined)).toBeUndefined();
    expect(await connect(NaN)).toBeUndefined();
  });
});
