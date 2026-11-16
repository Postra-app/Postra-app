import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

/**
 * Closes Stripe checkouts an organisation left open.
 *
 * A checkout opened on the web stays payable for a day. If the plan is then
 * bought in the iOS app, paying that old checkout would start a second,
 * Stripe-billed plan on top of the one Apple bills. Once Apple's plan is
 * written, the open checkouts of that customer are expired.
 */
@Injectable()
export class StripeOpenCheckouts {
  async expire(customerId: string | null | undefined): Promise<number> {
    if (!process.env.STRIPE_SECRET_KEY || !customerId?.startsWith('cus_')) {
      return 0;
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const open = await stripe.checkout.sessions.list({
      customer: customerId,
      status: 'open',
      limit: 100,
    });
    for (const session of open.data) {
      await stripe.checkout.sessions.expire(session.id);
    }
    return open.data.length;
  }
}
