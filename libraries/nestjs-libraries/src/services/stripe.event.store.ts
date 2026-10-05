import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Idempotency for Stripe webhooks.
 *
 * Stripe delivers at-least-once: any 5xx or timeout is retried for up to three
 * days, and the same event id arrives again. Without a guard, a redelivered
 * `customer.subscription.created` grants the subscription twice and a
 * redelivered `invoice.payment_succeeded` tops up credits twice.
 *
 * A delivery takes a short lease in Redis, runs the handler and only then
 * writes the event's row: the row means "done", the lease means "someone is
 * on it". A failure releases the lease and answers 500, so Stripe retries.
 */
@Injectable()
export class StripeEventStore {
  constructor(
    private _events: PrismaRepository<'stripeProcessedEvent'>
  ) {}

  /** The event was handled to the end before (its row is written last). */
  async isDone(id: string): Promise<boolean> {
    return !!(await this._events.model.stripeProcessedEvent.findUnique({
      where: { id },
      select: { id: true },
    }));
  }

  /**
   * A short lease while one delivery works on the event. The row used to be
   * the claim and was written first: a process killed mid-handler (a deploy,
   * a restart) left it behind, and every retry from Stripe answered
   * "duplicate" for work that never finished (E2E-07-13). A lease expires on
   * its own; the row now means "done".
   */
  async lease(id: string): Promise<boolean> {
    return (
      (await ioRedis.set(`stripe-event:${id}`, '1', 'EX', 5 * 60, 'NX')) === 'OK'
    );
  }

  async release(id: string): Promise<void> {
    await ioRedis.del(`stripe-event:${id}`).catch(() => undefined);
  }

  /**
   * Different events of one customer, one at a time. An update that read the
   * subscription, then lost the race to a deletion, wrote the old plan back
   * after it (BILL-2). The second event is retried by Stripe and then reads
   * the state the first one left.
   */
  async leaseCustomer(customerId: string, eventId: string): Promise<boolean> {
    return (
      (await ioRedis.set(`stripe-customer:${customerId}`, eventId, 'EX', 5 * 60, 'NX')) ===
      'OK'
    );
  }

  async releaseCustomer(customerId: string, eventId: string): Promise<void> {
    const key = `stripe-customer:${customerId}`;
    if ((await ioRedis.get(key).catch(() => null)) === eventId) {
      await ioRedis.del(key).catch(() => undefined);
    }
  }

  async markDone(id: string, type: string): Promise<void> {
    try {
      await this._events.model.stripeProcessedEvent.create({
        data: { id, type },
      });
    } catch (err: any) {
      // P2002: already marked by an earlier delivery — the same outcome.
      if (err?.code !== 'P2002') {
        throw err;
      }
    }
  }
}
