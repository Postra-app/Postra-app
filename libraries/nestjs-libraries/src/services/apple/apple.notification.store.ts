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
    private _notifications: PrismaRepository<'appleProcessedNotification'>,
    private _ended: PrismaRepository<'appleEndedPurchase'>
  ) {}

  /**
   * Apple said this purchase is over, at `signedAt`. Kept whether or not the
   * purchase is tied to an organisation: a refund can arrive before the app
   * has handed the purchase over, and a purchase can be moved after it ended.
   * Only ever moves forward in time.
   */
  async markEnded(originalTransactionId: string, signedAt: Date): Promise<void> {
    const known = await this.endedAt(originalTransactionId);
    if (known && known >= signedAt) {
      return;
    }
    await this._ended.model.appleEndedPurchase.upsert({
      where: { originalTransactionId },
      create: { originalTransactionId, signedAt },
      update: { signedAt },
    });
  }

  /** When Apple last said this purchase was over, if it ever did. */
  async endedAt(originalTransactionId: string): Promise<Date | null> {
    const row = await this._ended.model.appleEndedPurchase.findUnique({
      where: { originalTransactionId },
      select: { signedAt: true },
    });
    return row?.signedAt ?? null;
  }

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

  // `of` is a purchase's original transaction id, or `org:<id>` for an
  // organisation: two purchases handed over for one organisation at the same
  // moment must not both find it without a plan.
  async lease(of: string, holder: string): Promise<boolean> {
    const until = Date.now() + this.waitMs;
    while (
      (await ioRedis.set(
        `apple-transaction:${of}`,
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

  async release(of: string, holder: string): Promise<void> {
    const key = `apple-transaction:${of}`;
    if ((await ioRedis.get(key).catch((): null => null)) === holder) {
      await ioRedis.del(key).catch((): undefined => undefined);
    }
  }
}
