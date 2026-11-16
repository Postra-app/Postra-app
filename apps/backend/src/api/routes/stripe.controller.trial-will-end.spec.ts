const keys = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: jest.fn(async (k: string, v: string, ..._args: unknown[]) => {
      if (keys.has(k)) return null;
      keys.set(k, v);
      return 'OK';
    }),
    del: jest.fn(async (k: string) => (keys.delete(k) ? 1 : 0)),
    get: jest.fn(async (k: string) => keys.get(k) ?? null),
  },
}));

jest.mock('@gitroom/nestjs-libraries/services/stripe.service', () => ({
  StripeService: class {},
}));

import { StripeController } from './stripe.controller';
import { StripeEventStore } from '@gitroom/nestjs-libraries/services/stripe.event.store';

// Stripe's notice that a trial ends in three days reaches Postra's own
// reminder, and a redelivery of the same event does not mail twice.

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
  id: 'evt_trial_1',
  type: 'customer.subscription.trial_will_end',
  data: {
    object: { id: 'sub_1', customer: 'cus_1', metadata: { service: 'gitroom' } },
  },
};

describe('Stripe webhook: customer.subscription.trial_will_end', () => {
  beforeEach(() => {
    keys.clear();
    rows.clear();
  });

  it('runs the trial reminder once, a redelivery is a duplicate', async () => {
    const trialWillEnd = jest.fn().mockResolvedValue({ ok: true });
    const stripe = { validateRequest: () => event, trialWillEnd };
    const controller = new StripeController(
      stripe as any,
      new StripeEventStore(prisma as any)
    );
    const deliver = () =>
      controller.stripe({ rawBody: Buffer.from(''), headers: {} } as any);

    expect(await deliver()).toEqual({ ok: true });
    expect(trialWillEnd).toHaveBeenCalledTimes(1);
    expect(trialWillEnd).toHaveBeenCalledWith(event);

    expect(await deliver()).toEqual({ ok: true, duplicate: true });
    expect(trialWillEnd).toHaveBeenCalledTimes(1);
  });

  it('another service on the shared Stripe account is left alone', async () => {
    const trialWillEnd = jest.fn().mockResolvedValue({ ok: true });
    const other = {
      ...event,
      id: 'evt_trial_2',
      data: { object: { id: 'sub_2', customer: 'cus_2', metadata: {} } },
    };
    const controller = new StripeController(
      { validateRequest: () => other, trialWillEnd } as any,
      new StripeEventStore(prisma as any)
    );
    expect(
      await controller.stripe({ rawBody: Buffer.from(''), headers: {} } as any)
    ).toEqual({ ok: true });
    expect(trialWillEnd).not.toHaveBeenCalled();
  });
});
