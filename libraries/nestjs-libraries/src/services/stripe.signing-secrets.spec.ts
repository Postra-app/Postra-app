// Importing these for real drags in integration.manager → nostr-tools (ESM).
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({ TrackService: class {} }));

import Stripe from 'stripe';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';

// Signatures are made by the SDK's own test helper, as Stripe makes them.
const sdk = new Stripe('sk_test_signing');
const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'customer.subscription.updated', data: { object: {} } });
const signed = (secret: string) => sdk.webhooks.generateTestHeaderString({ payload, secret });

const service = new StripeService({} as any, {} as any, {} as any, {} as any, {} as any);
const verify = (header: string, key: string) =>
  service.validateRequest(Buffer.from(payload), header, key);

// While the webhook endpoint moves to a new API version, both endpoints
// deliver and each signs with its own secret.
describe('webhook signing secrets', () => {
  it('accepts an event signed with the only secret', () => {
    expect(verify(signed('whsec_old'), 'whsec_old').id).toBe('evt_1');
  });

  it('accepts either endpoint while the key holds both secrets', () => {
    expect(verify(signed('whsec_old'), 'whsec_old, whsec_new').id).toBe('evt_1');
    expect(verify(signed('whsec_new'), 'whsec_old,whsec_new').id).toBe('evt_1');
  });

  it('refuses a signature from a secret the key does not hold', () => {
    expect(() => verify(signed('whsec_other'), 'whsec_old,whsec_new')).toThrow(
      Stripe.errors.StripeSignatureVerificationError
    );
  });

  it('refuses everything when no secret is set', () => {
    expect(() => verify(signed('whsec_old'), '')).toThrow();
  });
});
