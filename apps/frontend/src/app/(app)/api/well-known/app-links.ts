/**
 * App Links (Android) and Universal Links (iOS) verification payloads.
 *
 * ⛔ Why these were missing and why it mattered (E2E-10-70 follow-up). Measured
 * on production 2026-09-19, before this shipped:
 *
 *   GET /.well-known/assetlinks.json              → 307 to /auth
 *   GET /.well-known/apple-app-site-association   → 307 to /auth
 *
 * Both operating systems fetch these with no cookies, and treat anything other
 * than a 200 carrying the file as "not verified" — silently. So no link of ours
 * could ever have been claimed by the app, and nobody would have seen an error
 * saying so. The proxy now lets `/.well-known/` through (see proxy.ts) and
 * these routes answer it.
 *
 * ⚠️ Deliberately narrow. The app must NOT claim `/auth/*`: registration and
 * password reset are web journeys that the app deliberately hands to the
 * browser, and claiming them would swallow the very links the app opens on
 * purpose. Only the mobile OAuth return path is claimed.
 */

/** The only path the native app is allowed to take over from the browser. */
export const MOBILE_LINK_PATHS = ['/integrations/mobile-return'];

export const ANDROID_PACKAGE = 'uk.co.postra.app';

/**
 * SHA-256 of the signing certificate, measured from the production AAB that
 * EAS built for this package (build `0cafde45`, artifact read with
 * `openssl pkcs7 -print_certs` on its META-INF block, 2026-09-19).
 *
 * ⚠️ This is the UPLOAD key. Once the app ships through Play App Signing,
 * Google re-signs it with a different certificate and the store build's
 * fingerprint will NOT be this one — that value comes from Play Console and
 * has to join the list, or App Links stop verifying for everyone who installs
 * from the store. `ANDROID_EXTRA_CERT_FINGERPRINTS` (comma separated) exists so
 * that value can be added without a code deploy.
 */
const UPLOAD_KEY_FINGERPRINT =
  'F4:59:8D:18:AD:10:20:6A:8F:F1:7A:7E:F1:C7:C4:F7:03:56:8E:26:18:4A:67:82:8A:88:A0:D1:C5:BE:D4:54';

/** 32 upper-case hex bytes joined by colons — the only form Android accepts. */
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function androidFingerprints(): string[] {
  // ⚠️ Anything malformed is dropped rather than published. A junk entry does
  // not fail loudly anywhere — Android simply never matches it — so a typo in
  // the env var would look exactly like a working file.
  const extra = (process.env.ANDROID_EXTRA_CERT_FINGERPRINTS || '')
    .split(',')
    .map((f) => f.trim().toUpperCase())
    .filter((f) => FINGERPRINT.test(f));

  return [...new Set([UPLOAD_KEY_FINGERPRINT, ...extra])];
}

export function assetLinks() {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: androidFingerprints(),
      },
    },
  ];
}

/**
 * `<TeamID>.<bundle id>`, read from the Apple Developer account's Membership
 * details page on 2026-09-20.
 *
 * Hardcoded on purpose: this is not a secret. It is published verbatim in the
 * AASA file this module serves, so every installed copy of every iOS app hands
 * its team id out to anyone who asks. Keeping it in the repo makes it
 * reviewable and removes an environment variable that could silently go
 * missing on a rebuild — and a missing one means a 404 here, which reads as
 * "not verified" to iOS.
 */
const IOS_APP_ID = '5S47VS43RB.uk.co.postra.app';

/**
 * ⚠️ `IOS_APP_ID` in the environment overrides the constant above, for the one
 * case that matters: the team id changing (an Individual enrolment converting
 * to an Organization one) between deploys. Anything blank falls back to the
 * constant rather than turning the file off.
 */
export function iosAppId(): string {
  return process.env.IOS_APP_ID?.trim() || IOS_APP_ID;
}

export function appleAppSiteAssociation(appId: string) {
  return {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: MOBILE_LINK_PATHS.map((path) => ({ '/': path })),
        },
      ],
    },
  };
}
