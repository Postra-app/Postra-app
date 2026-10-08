import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Every webhook delivery is signed, so the receiver can check that Postra
// sent it and that the body was not changed (E2E-08-49). Stripe's scheme,
// which receivers already know: the header carries the time and an
// HMAC-SHA256 of "<time>.<raw body>" with the webhook's secret.
export const WEBHOOK_SIGNATURE_HEADER = 'Postra-Signature';
export const WEBHOOK_ID_HEADER = 'Postra-Webhook-Id';

export const newWebhookSecret = () =>
  `whsec_${randomBytes(32).toString('base64url')}`;

export const signWebhookBody = (
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000)
) =>
  `t=${timestamp},v1=${createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')}`;

// What a receiver does (and what the docs show): recompute the HMAC over the
// raw body, compare in constant time, and refuse an old timestamp so a
// captured delivery cannot be replayed later.
export const verifyWebhookSignature = (
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000)
) => {
  const parts = Object.fromEntries(
    header.split(',').map((part) => part.split('=', 2) as [string, string])
  );
  const timestamp = Number(parts.t);
  if (!parts.v1 || !Number.isInteger(timestamp)) return false;
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest();
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
};
