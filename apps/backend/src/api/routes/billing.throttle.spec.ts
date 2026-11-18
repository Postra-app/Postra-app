import 'reflect-metadata';
import { BillingController } from '@gitroom/backend/api/routes/billing.controller';

// Every billing route that calls Stripe has its own limit. The app-wide guard
// only counts routes that carry @Throttle, so a route without one could call
// Stripe as fast as a client asks, and the Stripe account's request limit is
// shared by every customer's checkout and webhook.
describe('billing routes that call Stripe are rate limited', () => {
  const proto = BillingController.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  // Route handlers only (Nest stores the path on them); a helper counts
  // through the routes that call it.
  const reachesStripe = (name: string) =>
    /_stripeService|appleTrialAllowed\(/.test(proto[name].toString());
  const stripeRoutes = Object.getOwnPropertyNames(proto).filter(
    (name) =>
      name !== 'constructor' &&
      typeof proto[name] === 'function' &&
      Reflect.getMetadata('path', proto[name]) !== undefined &&
      reachesStripe(name)
  );

  it('finds the Stripe routes, the pending plan change among them', () => {
    expect(stripeRoutes).toContain('pendingChange');
  });

  it.each(stripeRoutes)('%s carries @Throttle', (name) => {
    expect(
      Reflect.getMetadata('THROTTLER:LIMITdefault', proto[name])
    ).toBeGreaterThan(0);
  });
});
