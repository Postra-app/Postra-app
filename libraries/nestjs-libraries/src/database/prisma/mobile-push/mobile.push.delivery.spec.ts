const zset = new Map<string, number>();
const kv = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    zadd: async (_k: string, ...args: (string | number)[]) => {
      for (let i = 0; i < args.length; i += 2) zset.set(String(args[i + 1]), Number(args[i]));
      return 1;
    },
    zrangebyscore: async (_k: string, min: number, max: number) =>
      [...zset.entries()].filter(([, s]) => s >= min && s <= max).map(([m]) => m),
    zremrangebyscore: async (_k: string, min: number, max: number) => {
      for (const [m, s] of zset) if (s >= min && s <= max) zset.delete(m);
      return 0;
    },
    zrem: async (_k: string, ...members: string[]) => members.forEach((m) => zset.delete(m)),
    set: async (k: string, v: string, ..._rest: unknown[]) => (kv.has(k) ? null : (kv.set(k, v), 'OK')),
    del: async (k: string) => kv.delete(k),
  },
}));

import { Logger } from '@nestjs/common';
import { MobilePushService } from './mobile.push.service';

// The answer from Expo was read only for DeviceNotRegistered: a refused
// request, a ticket error or a receipt saying Apple or Google would not take
// the message (a wrong APNs key, a wrong FCM sender) left no trace, so a
// broken iOS push would go unseen. And Expo takes at most 100 messages a
// request, which an organisation with more devices went over.
const tokens = (n: number) => Array.from({ length: n }, (_, i) => ({ token: `ExponentPushToken[t${i}]` }));
const make = (n: number) => {
  const model = { findMany: jest.fn().mockResolvedValue(tokens(n)), deleteMany: jest.fn() };
  return { service: new MobilePushService({ model: { mobilePushToken: model } } as any), model };
};
const reply = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json });

let warn: jest.SpyInstance;
beforeEach(() => {
  zset.clear();
  kv.clear();
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('sends at most 100 messages per request, with a time limit', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_u, init: any) =>
    reply(200, { data: JSON.parse(init.body).map((_: unknown, i: number) => ({ status: 'ok', id: `r${i}` })) }) as any
  );
  await make(230).service.notifyOrg('o', 'Title', 'Body');
  const sizes = fetchMock.mock.calls.map(([, init]: any) => JSON.parse(init.body).length);
  expect(sizes).toEqual([100, 100, 30]);
  expect(fetchMock.mock.calls.every(([, init]: any) => init.signal)).toBe(true);
});

it('logs a refused request and ticket errors by code, without tokens, and drops a gone device', async () => {
  const { service, model } = make(3);
  jest.spyOn(global, 'fetch').mockResolvedValueOnce(
    reply(200, {
      data: [
        { status: 'ok', id: 'r0' },
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
      ],
    }) as any
  );
  await service.notifyOrg('o', 'Title', 'Body');
  expect(model.deleteMany).toHaveBeenCalledWith({ where: { token: { in: ['ExponentPushToken[t1]'] } } });
  expect(warn.mock.calls.map(([m]) => m)).toEqual(['Expo push tickets with errors: MessageTooBig ×1']);

  jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply(429, { errors: [{ code: 'TOO_MANY_REQUESTS', message: 'x' }] }) as any);
  await service.notifyOrg('o', 'Title', 'Body');
  expect(warn.mock.calls[1][0]).toBe('Expo refused 3 push messages: HTTP 429 (TOO_MANY_REQUESTS)');
  expect(warn.mock.calls.flat().join(' ')).not.toContain('ExponentPushToken');
});

it('reads the receipts 15 minutes on: credentials errors are logged, a gone device is dropped', async () => {
  const { service, model } = make(3);
  jest.spyOn(global, 'fetch').mockResolvedValueOnce(
    reply(200, { data: [0, 1, 2].map((i) => ({ status: 'ok', id: `r${i}` })) }) as any
  );
  await service.notifyOrg('o', 'Title', 'Body');
  const sentAt = Date.now();

  // Too early: Expo is not asked.
  const early = jest.spyOn(global, 'fetch');
  early.mockClear();
  await service.checkReceipts(sentAt + 60_000);
  expect(early).not.toHaveBeenCalled();

  const receipts = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
    reply(200, {
      data: {
        r0: { status: 'ok' },
        r1: { status: 'error', details: { error: 'InvalidCredentials' } },
        r2: { status: 'error', details: { error: 'DeviceNotRegistered' } },
      },
    }) as any
  );
  await service.checkReceipts(sentAt + 16 * 60_000);
  expect(JSON.parse((receipts.mock.calls[0][1] as any).body)).toEqual({ ids: ['r0', 'r1', 'r2'] });
  expect(warn.mock.calls.map(([m]) => m)).toEqual(['Expo push receipts with errors: InvalidCredentials ×1']);
  expect(model.deleteMany).toHaveBeenCalledWith({ where: { token: { in: ['ExponentPushToken[t2]'] } } });
  // Read once: the next minute asks for nothing.
  expect(zset.size).toBe(0);
});

it('keeps the receipts for the next minute when Expo cannot answer', async () => {
  const { service } = make(1);
  jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply(200, { data: [{ status: 'ok', id: 'r0' }] }) as any);
  await service.notifyOrg('o', 'Title', 'Body');
  jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply(503, {}) as any);
  await service.checkReceipts(Date.now() + 16 * 60_000);
  expect(zset.size).toBe(1);
});

// Expo answers 200 before every receipt is ready: the ones it does not have
// yet are asked for again, not forgotten.
it('asks again next minute for a receipt Expo does not have yet', async () => {
  const { service, model } = make(2);
  jest.spyOn(global, 'fetch').mockResolvedValueOnce(
    reply(200, { data: [{ status: 'ok', id: 'r0' }, { status: 'ok', id: 'r1' }] }) as any
  );
  await service.notifyOrg('o', 'Title', 'Body');
  const at = Date.now() + 16 * 60_000;
  jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply(200, { data: { r0: { status: 'ok' } } }) as any);
  await service.checkReceipts(at);
  expect([...zset.keys()].map((m) => JSON.parse(m).id)).toEqual(['r1']);
  const again = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
    reply(200, { data: { r1: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }) as any
  );
  await service.checkReceipts(at + 60_000);
  expect(JSON.parse((again.mock.calls.at(-1)![1] as any).body)).toEqual({ ids: ['r1'] });
  expect(model.deleteMany).toHaveBeenCalledWith({ where: { token: { in: ['ExponentPushToken[t1]'] } } });
  expect(zset.size).toBe(0);
});
