jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: {} }));

import { AppleNotificationStore } from '@gitroom/nestjs-libraries/services/apple/apple.notification.store';

// When Apple last said a purchase was over. It must only move forward: a
// late copy of an older notification must not make a refunded purchase look
// less refunded.
const build = (signedAt: Date | null) => {
  const ended = {
    findUnique: jest.fn().mockResolvedValue(signedAt ? { signedAt } : null),
    upsert: jest.fn().mockResolvedValue({}),
  };
  const store = new AppleNotificationStore(
    { model: { appleProcessedNotification: {} } } as any,
    { model: { appleEndedPurchase: ended } } as any
  );
  return { store, ended };
};

describe('AppleNotificationStore: ended purchases', () => {
  const T = new Date('2026-11-15T12:00:00Z');

  it('nothing known: null', async () => {
    await expect(build(null).store.endedAt('1')).resolves.toBeNull();
  });

  it('the first report is kept', async () => {
    const { store, ended } = build(null);
    await store.markEnded('1', T);
    expect(ended.upsert).toHaveBeenCalledWith({
      where: { originalTransactionId: '1' },
      create: { originalTransactionId: '1', signedAt: T },
      update: { signedAt: T },
    });
  });

  it('a later report moves it forward', async () => {
    const { store, ended } = build(T);
    await store.markEnded('1', new Date(T.getTime() + 1000));
    expect(ended.upsert).toHaveBeenCalledTimes(1);
  });

  it('an earlier or equal one does not move it back', async () => {
    const { store, ended } = build(T);
    await store.markEnded('1', new Date(T.getTime() - 1000));
    await store.markEnded('1', T);
    expect(ended.upsert).not.toHaveBeenCalled();
    await expect(store.endedAt('1')).resolves.toEqual(T);
  });
});
