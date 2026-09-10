import { isMissingCustomerError } from '@gitroom/nestjs-libraries/services/stripe.errors';

// Shape copied from a real Stripe rejection: the error that reached Sentry as
// an unhandled 500 on GET /billing/check/:id.
const noSuchCustomer = {
  type: 'invalid_request_error',
  code: 'resource_missing',
  param: 'customer',
  message: "No such customer: 'cus_U9EdTfSreZXTPu'",
  statusCode: 400,
};

describe('isMissingCustomerError', () => {
  it('recognises the customer Stripe no longer has', () => {
    expect(isMissingCustomerError(noSuchCustomer)).toBe(true);
  });

  it('recognises it from the message when param is absent', () => {
    const { param, ...withoutParam } = noSuchCustomer;
    expect(isMissingCustomerError(withoutParam)).toBe(true);
  });

  it('does not swallow a missing subscription, price or invoice', () => {
    // Same code, different resource — that one is a real bug on our side and
    // has to keep throwing.
    expect(
      isMissingCustomerError({
        type: 'invalid_request_error',
        code: 'resource_missing',
        param: 'subscription',
        message: "No such subscription: 'sub_123'",
      })
    ).toBe(false);
  });

  it('does not swallow other Stripe failures', () => {
    expect(
      isMissingCustomerError({
        type: 'card_error',
        code: 'card_declined',
        message: 'Your card was declined.',
      })
    ).toBe(false);
    expect(
      isMissingCustomerError({
        type: 'api_error',
        code: 'resource_missing',
        message: 'No such customer',
      })
    ).toBe(false);
    expect(
      isMissingCustomerError({
        type: 'invalid_request_error',
        code: 'parameter_invalid_empty',
        param: 'customer',
        message: 'You passed an empty string for customer.',
      })
    ).toBe(false);
  });

  it('survives anything that is not a Stripe error object', () => {
    expect(isMissingCustomerError(null)).toBe(false);
    expect(isMissingCustomerError(undefined)).toBe(false);
    expect(isMissingCustomerError('No such customer')).toBe(false);
    expect(isMissingCustomerError(new Error('No such customer'))).toBe(false);
  });
});
