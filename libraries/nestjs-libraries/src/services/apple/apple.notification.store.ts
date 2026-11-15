import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Idempotency and ordering for App Store Server Notifications, as
 * StripeEventStore does for Stripe: Apple redelivers on any answer but 200,
 * and two notifications about one purchase must not be applied at once.
 *
 * The row means "handled to the end"; the lease means "someone is on it" and
 * expires on its own if the process dies.
 */
@Injectable()
export class AppleNotificationStore {
  constructor(
    private _notifications: PrismaRepository<'appleProcessedNotification'>
  ) {}

  async isDone(id: string): Promise<boolean> {
    return !!(await this._notifications.model.appleProcessedNotification.findUnique(
      { where: { id }, select: { id: true } }
    ));
  }

  async markDone(id: string, type: string): Promise<void> {
    try {
      await this._notifications.model.appleProcessedNotification.create({
        data: { id, type },
      });
    } catch (err: any) {
      // P2002: an earlier delivery marked it — the same outcome.
      if (err?.code !== 'P2002') {
        throw err;
      }
    }
  }

  // One write per purchase at a time, whether it comes from a notification or
  // from the app handing over its transaction.
  waitMs = 10_000;

  async lease(originalTransactionId: string, holder: string): Promise<boolean> {
    const until = Date.now() + this.waitMs;
    while (
      (await ioRedis.set(
        `apple-transaction:${originalTransactionId}`,
        holder,
        'EX',
        5 * 60,
        'NX'
      )) !== 'OK'
    ) {
      if (Date.now() >= until) {
        return false;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return true;
  }

  async release(originalTransactionId: string, holder: string): Promise<void> {
    const key = `apple-transaction:${originalTransactionId}`;
    if ((await ioRedis.get(key).catch((): null => null)) === holder) {
      await ioRedis.del(key).catch((): undefined => undefined);
    }
  }
}
