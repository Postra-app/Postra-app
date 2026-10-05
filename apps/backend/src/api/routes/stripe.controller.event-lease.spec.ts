const keys = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: jest.fn(async (k: string, v: string, ..._args: unknown[]) => {
      if (keys.has(k)) return null;
      keys.set(k, v);
      return 'OK';
    }),
    del: jest.fn(async (k: string) => (keys.delete(k) ? 1 : 0)),
  },
}));

jest.mock('@gitroom/nestjs-libraries/services/stripe.service', () => ({
  StripeService: class {},
}));

import { HttpException } from '@nestjs/common';
import { StripeController } from './stripe.controller';
import { StripeEventStore } from '@gitroom/nestjs-libraries/services/stripe.event.store';

/**
 * E2E-07-13 — the event id was written before the handler ran. A process
 * killed in the middle (a deploy, a restart) left it behind, and every retry
 * from Stripe was answered "duplicate" for work that never finished: a paid
 * subscription that was never granted.
 */
const rows = new Set<string>();
const prisma = {
  model: {
    stripeProcessedEvent: {
      findUnique: jest.fn(async ({ where }: any) =>
        rows.has(where.id) ? { id: where.id } : null
      ),
      create: jest.fn(async ({ data }: any) => {
        if (rows.has(data.id))
          throw Object.assign(new Error('dup'), { code: 'P2002' });
        rows.add(data.id);
        return data;
      }),
      delete: jest.fn(async ({ where }: any) => rows.delete(where.id)),
    },
  },
};

const event = {
  id: 'evt_1',
  type: 'customer.subscription.created',
  data: { object: { metadata: { service: 'gitroom' } } },
};

const setup = (createSubscription: () => Promise<unknown>) => {
  const stripe = {
    validateRequest: () => event,
    createSubscription: jest.fn(createSubscription),
  };
  const store = new StripeEventStore(prisma as any);
  const controller = new StripeController(stripe as any, store);
  const deliver = async () => {
    try {
      return {
        status: 200,
        body: await controller.stripe({
          rawBody: Buffer.from(''),
          headers: {},
        } as any),
      };
    } catch (e) {
      if (!(e instanceof HttpException)) throw e;
      return { status: e.getStatus(), body: e.getResponse() };
    }
  };
  return { stripe, deliver, store };
};

describe('Stripe webhook: one run per event, and a crash is not "done"', () => {
  beforeEach(() => {
    keys.clear();
    rows.clear();
  });

  it('a retry after a killed run handles the event', async () => {
    // First delivery: the process dies inside the handler — it never returns.
    const first = setup(() => new Promise(() => undefined));
    void first.deliver();
    await new Promise((r) => setImmediate(r));
    expect(first.stripe.createSubscription).toHaveBeenCalledTimes(1);

    // While that lease is alive, a parallel delivery is told to come back.
    const parallel = setup(async () => undefined);
    expect((await parallel.deliver()).status).toBe(409);
    expect(parallel.stripe.createSubscription).not.toHaveBeenCalled();

    // The lease expires (the process is gone); Stripe's retry does the work.
    keys.clear();
    const retry = setup(async () => undefined);
    expect((await retry.deliver()).status).toBe(200);
    expect(retry.stripe.createSubscription).toHaveBeenCalledTimes(1);

    // Done now: one more redelivery is a duplicate, not a second grant.
    const again = setup(async () => undefined);
    expect((await again.deliver()).body).toEqual({ ok: true, duplicate: true });
    expect(again.stripe.createSubscription).not.toHaveBeenCalled();
  });

  it('a failed handler answers 500 and the retry runs it again', async () => {
    const failing = setup(async () => {
      throw new Error('db down');
    });
    expect((await failing.deliver()).status).toBe(500);
    const retry = setup(async () => undefined);
    expect((await retry.deliver()).status).toBe(200);
    expect(retry.stripe.createSubscription).toHaveBeenCalledTimes(1);
  });

  it('a delivery that finishes between the check and the lease is not run twice', async () => {
    const late = setup(async () => undefined);
    const { store } = late;
    const lease = store.lease.bind(store);
    jest.spyOn(store, 'lease').mockImplementation(async (id) => {
      // The other delivery runs from start to end right here.
      const first = setup(async () => undefined);
      expect((await first.deliver()).status).toBe(200);
      return lease(id);
    });
    expect((await late.deliver()).body).toEqual({ ok: true, duplicate: true });
    expect(late.stripe.createSubscription).not.toHaveBeenCalled();
    expect(keys.size).toBe(0);
  });
});
