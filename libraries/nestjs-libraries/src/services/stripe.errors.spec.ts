import Stripe from 'stripe';
import { isMissingCustomerError } from '@gitroom/nestjs-libraries/services/stripe.errors';

// Errors are built through the SDK, never by hand.
//
// The first version of this file wrote `{ type: 'invalid_request_error', … }`
// object literals. A real rejection does not look like that: the SDK puts the
// class name in `type` (`StripeInvalidRequestError`) and the API's type in
// `rawType`. Ten tests passed against a shape that never reaches production,
// and the fix they were guarding did nothing (E2E-07-02).
const raise = (raw: Record<string, unknown>) =>
  Stripe.errors.StripeError.generate(raw as any);

const noSuchCustomer = () =>
  raise({
    type: 'invalid_request_error',
    code: 'resource_missing',
    param: 'customer',
    message: "No such customer: 'cus_U9EdTfSreZXTPu'",
    statusCode: 400,
  });

describe('the SDK error shape this predicate has to read', () => {
  it('keeps the API type in rawType, not in type', () => {
    const err = noSuchCustomer();
    expect(err.type).toBe('StripeInvalidRequestError');
    expect((err as any).rawType).toBe('invalid_request_error');
  });
});

describe('isMissingCustomerError', () => {
  it('recognises the customer Stripe no longer has', () => {
    expect(isMissingCustomerError(noSuchCustomer())).toBe(true);
  });

  it('recognises it from the message when param is absent', () => {
    expect(
      isMissingCustomerError(
        raise({
          type: 'invalid_request_error',
          code: 'resource_missing',
          message: "No such customer: 'cus_U9EdTfSreZXTPu'",
          statusCode: 400,
        })
      )
    ).toBe(true);
  });

  it('does not swallow a missing subscription, price or invoice', () => {
    // Same code, different resource — that one is a real bug on our side and
    // has to keep throwing.
    expect(
      isMissingCustomerError(
        raise({
          type: 'invalid_request_error',
          code: 'resource_missing',
          param: 'subscription',
          message: "No such subscription: 'sub_123'",
        })
      )
    ).toBe(false);
  });

  it('does not swallow other Stripe failures', () => {
    expect(
      isMissingCustomerError(
        raise({
          type: 'card_error',
          code: 'card_declined',
          message: 'Your card was declined.',
        })
      )
    ).toBe(false);
    expect(
      isMissingCustomerError(
        raise({
          type: 'api_error',
          code: 'resource_missing',
          message: 'No such customer',
        })
      )
    ).toBe(false);
    expect(
      isMissingCustomerError(
        raise({
          type: 'invalid_request_error',
          code: 'parameter_invalid_empty',
          param: 'customer',
          message: 'You passed an empty string for customer.',
        })
      )
    ).toBe(false);
  });

  it('still reads a plain object that carries the API type directly', () => {
    // Errors crossing a process boundary — a queue, a serialised log — arrive
    // flattened, without the class that carries rawType.
    expect(
      isMissingCustomerError({
        type: 'invalid_request_error',
        code: 'resource_missing',
        param: 'customer',
        message: "No such customer: 'cus_123'",
      })
    ).toBe(true);
  });

  it('survives anything that is not a Stripe error object', () => {
    expect(isMissingCustomerError(null)).toBe(false);
    expect(isMissingCustomerError(undefined)).toBe(false);
    expect(isMissingCustomerError('No such customer')).toBe(false);
    expect(isMissingCustomerError(new Error('No such customer'))).toBe(false);
  });
});
