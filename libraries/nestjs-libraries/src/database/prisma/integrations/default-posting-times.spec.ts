jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';

// A new channel gets three posting times: 09:20, 14:10 and 19:00 in the
// customer's time zone. They used to be minutes after UTC midnight shifted by
// the browser's offset on the day of connecting, so they moved by an hour at
// every clock change (E2E-05-85). The web app sends the IANA zone; the mobile
// app still sends the offset.
describe('posting times of a new channel', () => {
  afterEach(() => jest.useRealTimers());

  const connect = async (timezone?: number | string) => {
    const upsert = jest.fn().mockResolvedValue({ id: 'int-1', providerIdentifier: 'bluesky' });
    const integration = { upsert, findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn() };
    const repository = new IntegrationRepository({ model: { integration } } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await repository.createOrUpdateIntegration(undefined, true, 'org-1', 'Channel', undefined, 'social', 'int-1', 'bluesky', 'token', '', 3600, 'user', false, undefined, timezone);
    const times = upsert.mock.calls[0][0].create.postingTimes;
    return times ? JSON.parse(times) : undefined;
  };

  const local = (tz: string) => [
    { time: 560, tz },
    { time: 850, tz },
    { time: 1140, tz },
  ];

  it('keeps the times in the zone the web app sends', async () => {
    expect(await connect('Europe/London')).toEqual(local('Europe/London'));
    expect(await connect('Europe/Warsaw')).toEqual(local('Europe/Warsaw'));
  });

  it("takes London's current offset from the mobile app as London", async () => {
    jest.useFakeTimers({ now: new Date('2026-10-09T12:00:00Z') });
    expect(await connect('60')).toEqual(local('Europe/London'));
    jest.useFakeTimers({ now: new Date('2026-11-09T12:00:00Z') });
    expect(await connect('0')).toEqual(local('Europe/London'));
  });

  it('shifts them to UTC for any other offset', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-09T12:00:00Z') });
    expect(await connect('120')).toEqual([{ time: 440 }, { time: 730 }, { time: 1020 }]);
  });

  it('leaves the defaults when no usable zone came with the request', async () => {
    expect(await connect(undefined)).toBeUndefined();
    expect(await connect('NaN')).toBeUndefined();
    expect(await connect('Not/AZone')).toBeUndefined();
  });
});
