/**
 * A Stripe customer id we stored that Stripe no longer knows.
 *
 * `Organization.paymentId` outlives the customer it points at: the customer can
 * be deleted in the dashboard, or the row can survive a switch of Stripe keys.
 * Every later call made with that id comes back as
 * `No such customer: 'cus_…'` — an `invalid_request_error` with
 * `code: 'resource_missing'` and `param: 'customer'`.
 *
 * Read paths must treat that as "this org has no customer" instead of throwing:
 * an org whose customer is gone has no charges and no subscriptions, so a 500
 * on `/billing/check/:id` is the wrong answer to a question we can answer
 * (e2e/bugs.md — Sentry "No such customer" on GET /billing/check/:id).
 */
export function isMissingCustomerError(err: unknown): boolean {
  const e = err as {
    type?: string;
    rawType?: string;
    code?: string;
    param?: string;
    message?: string;
  } | null;

  if (!e || typeof e !== 'object') {
    return false;
  }

  // The SDK puts the API's error type in `rawType`; `type` holds the *class*
  // name (`StripeInvalidRequestError`). Reading `type` alone matched an object
  // built by hand in a spec and never matched a real rejection, which is how
  // this shipped with ten green tests and no effect on production
  // (e2e/bugs.md — E2E-07-02). Verified against stripe@20.4.0.
  const apiType = e.rawType ?? e.type;

  if (apiType !== 'invalid_request_error' || e.code !== 'resource_missing') {
    return false;
  }

  // Narrow to the customer. The same code answers a missing subscription,
  // price or invoice, and those are real errors we still want to see.
  return e.param === 'customer' || /No such customer/i.test(e.message ?? '');
}
