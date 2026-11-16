import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// Subscriptions bought in the iOS app are billed by Apple. Everything here is
// off unless APPLE_IAP_ENABLED is set, so a deployment without it behaves
// exactly as before.
export const appleIapEnabled = () => !!process.env.APPLE_IAP_ENABLED;

export const appleBundleId = () =>
  process.env.APPLE_IAP_BUNDLE_ID || 'uk.co.postra.app';

// The app's numeric id in App Store Connect. Apple's library requires it to
// verify anything signed in the Production environment.
export const appleAppId = () => {
  const id = Number(process.env.APPLE_IAP_APP_ID || 0);
  return Number.isFinite(id) && id > 0 ? id : undefined;
};

export type AppleTier = 'STANDARD' | 'PRO' | 'ULTIMATE';

// Product ids as created in App Store Connect. Monthly only, and each plan
// twice: once with the free week as its introductory offer and once without.
// Apple decides who gets an introductory offer by Apple ID and knows nothing
// of a trial already taken on the web, so an organisation that has had its
// trial is offered the products that have none.
const WITH_TRIAL: Record<string, AppleTier> = {
  'uk.co.postra.app.starter.monthly': 'STANDARD',
  'uk.co.postra.app.pro.monthly': 'PRO',
  'uk.co.postra.app.business.monthly': 'ULTIMATE',
};
const WITHOUT_TRIAL: Record<string, AppleTier> = {
  'uk.co.postra.app.starter.monthly.notrial': 'STANDARD',
  'uk.co.postra.app.pro.monthly.notrial': 'PRO',
  'uk.co.postra.app.business.monthly.notrial': 'ULTIMATE',
};
export const APPLE_PRODUCTS: Record<string, AppleTier> = {
  ...WITH_TRIAL,
  ...WITHOUT_TRIAL,
};

export const appleTierOf = (productId?: string | null): AppleTier | null =>
  (productId &&
    Object.prototype.hasOwnProperty.call(APPLE_PRODUCTS, productId) &&
    APPLE_PRODUCTS[productId]) ||
  null;

// The plans to show an organisation: with the free week only while it may
// still have a trial, by the same rule the web's plan page goes by.
export const applePlans = (trial: boolean) =>
  Object.entries(trial ? WITH_TRIAL : WITHOUT_TRIAL).map(
    ([productId, tier]) => ({
      productId,
      tier,
      channels: pricing[tier].channel,
    })
  );

// Purchases made in Apple's test environment (TestFlight, a sandbox tester,
// an app reviewer) are real plans to this server. They are accepted only for
// the organisations named in APPLE_IAP_SANDBOX_ORGS (comma separated; "*" on
// a test stack), or anyone holding a TestFlight build would have a free plan.
export const appleSandboxAllowedFor = (organizationId: string) => {
  const list = (process.env.APPLE_IAP_SANDBOX_ORGS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return list.includes('*') || list.includes(organizationId);
};

// The purchase is bound to the organisation it was made for: the app passes
// the organisation's id (a UUID) to StoreKit as the appAccountToken, and
// Apple signs it into every transaction of that purchase.
export const appleAccountTokenFor = (organizationId: string) =>
  organizationId.toLowerCase();

// How long past the end of the paid period (or Apple's billing grace period)
// a plan stays when no notification has said it renewed. Apple retries a
// notification it could not deliver, and a late renewal or the app's next
// sync brings the plan back, so this only bounds a plan nobody pays for.
export const APPLE_EXPIRY_MARGIN_MS = 24 * 60 * 60 * 1000;

export type AppleTransaction = {
  originalTransactionId?: string;
  appAccountToken?: string;
  productId?: string;
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  offerDiscountType?: string;
  signedDate?: number;
  environment?: string;
};

export type AppleRenewal = {
  autoRenewStatus?: number;
  gracePeriodExpiresDate?: number;
  signedDate?: number;
};

export type AppleState =
  | { state: 'ended'; reason: 'revoked' | 'expired' | 'unknown-product' }
  // A transaction for a period that is already over and was refunded since:
  // it says nothing about the plan in force, which a later period pays for.
  | { state: 'stale' }
  | {
      state: 'active';
      tier: AppleTier;
      isTrailing: boolean;
      // Unix seconds, as SubscriptionService takes it. Set when the customer
      // has turned auto-renew off: the plan ends when the paid period does.
      cancelAt: number | null;
      periodAnchor: Date | undefined;
      // The end of the paid period, or of Apple's billing grace period when
      // that is later. Housekeeping ends a plan nothing has renewed by then.
      endsAt: Date | null;
    };

/**
 * What a signed transaction (and, from a notification, its renewal info)
 * means for the organisation's plan at `now`.
 *
 * Read from the dates Apple signed rather than from the notification's type:
 * a delivery that arrives late or twice then still says the right thing. A
 * refund or a family-sharing revoke sets revocationDate; a lapsed plan has an
 * expiresDate in the past, unless Apple is still retrying the payment inside
 * a billing grace period.
 *
 * A refund ends the plan only when it takes back the period in force. Apple
 * signs a refund of an earlier renewal with that renewal's own dates, which
 * are over; the period being paid for now is still paid for.
 */
export const appleStateOf = (
  transaction: AppleTransaction,
  renewal: AppleRenewal | undefined,
  now: number
): AppleState => {
  const expires = transaction.expiresDate || 0;
  if (transaction.revocationDate) {
    return expires && expires <= now
      ? { state: 'stale' }
      : { state: 'ended', reason: 'revoked' };
  }
  const tier = appleTierOf(transaction.productId);
  if (!tier) {
    return { state: 'ended', reason: 'unknown-product' };
  }
  const grace = renewal?.gracePeriodExpiresDate || 0;
  if (expires <= now && grace <= now) {
    return { state: 'ended', reason: 'expired' };
  }
  return {
    state: 'active',
    tier,
    isTrailing: transaction.offerDiscountType === 'FREE_TRIAL',
    cancelAt:
      renewal?.autoRenewStatus === 0 && expires
        ? Math.floor(expires / 1000)
        : null,
    periodAnchor: transaction.purchaseDate
      ? new Date(transaction.purchaseDate)
      : undefined,
    endsAt: expires || grace ? new Date(Math.max(expires, grace)) : null,
  };
};

// Apple Root CA - G3, the root of every App Store signature. Valid to 2039.
// SHA-256 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79
export const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----
`;
