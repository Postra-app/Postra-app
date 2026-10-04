import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import Stripe from 'stripe';

export const PAYMENTS_UNAVAILABLE =
  'Payments are unavailable right now. Please try again in a few minutes.';

// A Stripe error carries statusCode and message, and Nest's default handler
// sends any such error to the browser as is. Stripe refusing *our* key came
// back as a 401 with "Invalid API Key provided: …" — and the app treats a
// 401 as an ended session, so everyone on the paywall was signed out. A card
// error is the customer's to fix and keeps Stripe's own wording (as a 400,
// not 402, which the app reads as "upgrade your plan"); anything else is ours
// to fix: logged, and a 502 with nothing of Stripe's in it.
@Catch(Stripe.errors.StripeError)
export class StripeErrorExceptionFilter implements ExceptionFilter {
  catch(exception: InstanceType<typeof Stripe.errors.StripeError>, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (exception.type === 'StripeCardError') {
      return response.status(400).json({ statusCode: 400, message: exception.message });
    }
    Logger.error(
      `Stripe ${exception.type} ${exception.statusCode ?? ''} ${exception.code ?? ''} ${exception.requestId ?? ''}: ${exception.message}`
    );
    return response.status(502).json({ statusCode: 502, message: PAYMENTS_UNAVAILABLE });
  }
}
