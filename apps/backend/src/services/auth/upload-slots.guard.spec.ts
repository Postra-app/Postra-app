import { EventEmitter } from 'events';
import { HttpException } from '@nestjs/common';

// One Redis for every worker, like production's: the organisation's slots
// are leases there. `eval` does what TAKE_ORG_SLOT does in Redis.
const mockLeases = new Map<string, Map<string, number>>();
let mockRedisDown = false;
let mockRedisWait: Promise<void> | undefined;
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => {
  const down = () => {
    if (mockRedisDown) throw new Error('connect ECONNREFUSED');
  };
  return {
    ioRedis: {
      eval: async (
        _script: string,
        _keys: number,
        key: string,
        now: string,
        until: string,
        limit: string,
        lease: string
      ) => {
        if (mockRedisWait) await mockRedisWait;
        down();
        const set = mockLeases.get(key) || new Map<string, number>();
        for (const [id, end] of set) if (end <= Number(now)) set.delete(id);
        mockLeases.set(key, set);
        if (set.size >= Number(limit)) return 0;
        set.set(lease, Number(until));
        return 1;
      },
      zrem: async (key: string, lease: string) => {
        down();
        return mockLeases.get(key)?.delete(lease) ? 1 : 0;
      },
    },
  };
});

import {
  ORG_SLOT_LEASE_MS,
  SLOTS_PER_INSTANCE,
  TAKE_ORG_SLOT,
  UploadSlotsGuard,
  resetUploadSlots,
  uploadSlotsInUse,
} from './upload-slots.guard';

type GuardModule = typeof import('./upload-slots.guard');

// Buffered uploads (up to 220 MB in memory each) are limited so
// a few accounts cannot take the instance down with parallel large bodies.
const call = (org: string, length?: number, Guard = UploadSlotsGuard) => {
  const res: any = Object.assign(new EventEmitter(), { setHeader: jest.fn() });
  const req = { org: { id: org }, headers: length === undefined ? {} : { 'content-length': String(length) } };
  const ctx: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
  return { run: () => new Guard().canActivate(ctx), res };
};
const status = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (e) {
    return (e as HttpException).getStatus();
  }
  return 200;
};
const leases = (org: string) => mockLeases.get(`upload-slots:${org}`)?.size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));
const MB = 1024 * 1024;

// A second backend worker: its own copy of the module (its own memory), the
// same Redis.
const otherWorker = (): GuardModule => {
  let mod: GuardModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('./upload-slots.guard');
  });
  return mod!;
};

describe('UploadSlotsGuard', () => {
  const processes = process.env.BACKEND_PROCESSES;
  beforeEach(() => {
    delete process.env.BACKEND_PROCESSES;
    mockLeases.clear();
    mockRedisDown = false;
    mockRedisWait = undefined;
    resetUploadSlots();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => {
    if (processes === undefined) delete process.env.BACKEND_PROCESSES;
    else process.env.BACKEND_PROCESSES = processes;
  });

  it('lets small bodies through without a slot', async () => {
    for (let i = 0; i < 20; i++) expect(await call('org-a', 2 * MB).run()).toBe(true);
    expect(uploadSlotsInUse().total).toBe(0);
    expect(mockLeases.size).toBe(0);
  });

  it('two large uploads per organisation at a time; the third gets 429 with Retry-After', async () => {
    expect(await call('org-a', 200 * MB).run()).toBe(true);
    expect(await call('org-a', 200 * MB).run()).toBe(true);
    const third = call('org-a', 200 * MB);
    expect(await status(third.run)).toBe(429);
    expect(third.res.setHeader).toHaveBeenCalledWith('Retry-After', '10');
    // The refused one gave back the worker slot it took.
    expect(leases('org-a')).toBe(2);
    expect(uploadSlotsInUse().total).toBe(2);
    // Another organisation is not held up by this one.
    expect(await call('org-b', 200 * MB).run()).toBe(true);
  });

  it('a finished upload frees its slot, once even when both events fire', async () => {
    const a = call('org-a', 200 * MB);
    await a.run();
    await call('org-a', 200 * MB).run();
    a.res.emit('finish');
    a.res.emit('close');
    await tick();
    expect(uploadSlotsInUse().total).toBe(1);
    expect(leases('org-a')).toBe(1);
    expect(await call('org-a', 200 * MB).run()).toBe(true);
    expect(await status(call('org-a', 200 * MB).run)).toBe(429);
  });

  it('the instance takes at most four large uploads, whoever sends them', async () => {
    for (let i = 0; i < SLOTS_PER_INSTANCE; i++) expect(await call(`org-${i}`, 100 * MB).run()).toBe(true);
    expect(await status(call('org-z', 100 * MB).run)).toBe(429);
  });

  it('a body without a length counts as large', async () => {
    await call('org-a', undefined).run();
    expect(uploadSlotsInUse().total).toBe(1);
  });

  it('a client gone while Redis answered frees both slots', async () => {
    let answer!: () => void;
    mockRedisWait = new Promise((r) => (answer = r));
    const a = call('org-a', 200 * MB);
    const pending = a.run();
    await tick();
    a.res.emit('close'); // the client goes away during the wait
    answer();
    expect(await pending).toBe(false);
    await tick();
    expect(uploadSlotsInUse().total).toBe(0);
    expect(leases('org-a')).toBe(0);
  });

  it('a lease left by a dead worker ends on time, however often the organisation retries', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    // A worker took both and died: nothing will release them.
    mockLeases.set('upload-slots:org-a', new Map([
      ['dead-1', now + ORG_SLOT_LEASE_MS],
      ['dead-2', now + ORG_SLOT_LEASE_MS],
    ]));
    // Retried every 10 s, as Retry-After says, for most of the lease.
    for (let t = 0; t < ORG_SLOT_LEASE_MS - 10_000; t += 10_000) {
      now = 1_000_000 + t;
      expect(await status(call('org-a', 200 * MB).run)).toBe(429);
    }
    now = 1_000_000 + ORG_SLOT_LEASE_MS;
    expect(await call('org-a', 200 * MB).run()).toBe(true);
  });

  it('takes the slot in one Redis script, counting only leases still running', () => {
    expect(TAKE_ORG_SLOT).toMatch(/ZREMRANGEBYSCORE/);
    expect(TAKE_ORG_SLOT.indexOf('ZREMRANGEBYSCORE')).toBeLessThan(TAKE_ORG_SLOT.indexOf('ZCARD'));
    // A refused attempt returns before anything is written.
    expect(TAKE_ORG_SLOT.indexOf('return 0')).toBeLessThan(TAKE_ORG_SLOT.indexOf('ZADD'));
  });

  describe('with two backend workers on the instance', () => {
    beforeEach(() => {
      process.env.BACKEND_PROCESSES = '2';
    });

    it('each worker takes half of the instance', async () => {
      const second = otherWorker();
      expect(await call('org-1', 100 * MB).run()).toBe(true);
      expect(await call('org-2', 100 * MB).run()).toBe(true);
      expect(await status(call('org-3', 100 * MB).run)).toBe(429);
      expect(await call('org-3', 100 * MB, second.UploadSlotsGuard).run()).toBe(true);
      expect(await call('org-4', 100 * MB, second.UploadSlotsGuard).run()).toBe(true);
      expect(await status(call('org-5', 100 * MB, second.UploadSlotsGuard).run)).toBe(429);
    });

    it('an organisation holds two slots on the instance, not two in each worker', async () => {
      const second = otherWorker();
      expect(await call('org-a', 200 * MB).run()).toBe(true);
      expect(await call('org-a', 200 * MB, second.UploadSlotsGuard).run()).toBe(true);
      // Each worker has a slot left, but the organisation has used its two.
      expect(await status(call('org-a', 200 * MB).run)).toBe(429);
      expect(await status(call('org-a', 200 * MB, second.UploadSlotsGuard).run)).toBe(429);
      expect(await call('org-b', 200 * MB, second.UploadSlotsGuard).run()).toBe(true);
    });
  });

  it('without Redis the organisation is still limited, in the worker', async () => {
    mockRedisDown = true;
    expect(await call('org-a', 200 * MB).run()).toBe(true);
    expect(await call('org-a', 200 * MB).run()).toBe(true);
    expect(await status(call('org-a', 200 * MB).run)).toBe(429);
  });
});
