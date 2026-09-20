import {
  ANDROID_PACKAGE,
  MOBILE_LINK_PATHS,
  androidFingerprints,
  appleAppSiteAssociation,
  assetLinks,
  iosAppId,
} from './app-links';

/**
 * ⛔ Measured on production 2026-09-19, before any of this existed:
 *
 *   GET /.well-known/assetlinks.json            → 307 to /auth
 *   GET /.well-known/apple-app-site-association → 307 to /auth
 *
 * Android and iOS fetch those with no cookies, follow no redirect, and report
 * nothing when verification fails — so app links could never have worked and
 * nothing would have said so. These tests pin the two things that are easy to
 * get silently wrong: the shape both operating systems parse, and the set of
 * paths the app is allowed to take over.
 */
describe('assetlinks.json', () => {
  const OLD = process.env.ANDROID_EXTRA_CERT_FINGERPRINTS;
  afterEach(() => {
    // ⚠️ Assigning `undefined` to process.env stores the STRING "undefined",
    // which the next test then parses as a fingerprint. Delete instead.
    if (OLD === undefined) delete process.env.ANDROID_EXTRA_CERT_FINGERPRINTS;
    else process.env.ANDROID_EXTRA_CERT_FINGERPRINTS = OLD;
  });

  it('claims the package the store build actually uses', () => {
    // ⛔ `com.postra.app` was taken by another company on both stores, so the
    // identifier moved (E2E-10-46). A stale one here verifies nothing.
    expect(ANDROID_PACKAGE).toBe('uk.co.postra.app');
    expect(assetLinks()[0].target.package_name).toBe('uk.co.postra.app');
  });

  it('has the shape Android parses', () => {
    const [entry] = assetLinks();
    expect(entry.relation).toEqual([
      'delegate_permission/common.handle_all_urls',
    ]);
    expect(entry.target.namespace).toBe('android_app');
    expect(entry.target.sha256_cert_fingerprints.length).toBeGreaterThan(0);
  });

  it('every fingerprint is upper-case colon-separated SHA-256', () => {
    for (const fp of androidFingerprints()) {
      expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
  });

  /**
   * ⚠️ The built-in fingerprint is the UPLOAD key. Play App Signing re-signs
   * the store build with Google's own certificate, and without that second
   * fingerprint app links break for everyone who installs from the store —
   * which is everyone. This is the seam that lets it be added without a deploy.
   */
  it('takes extra fingerprints from the environment, de-duplicated', () => {
    const play = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
    process.env.ANDROID_EXTRA_CERT_FINGERPRINTS = `${play}, ${play}`;

    const all = androidFingerprints();
    expect(all).toContain(play);
    expect(all.filter((f) => f === play)).toHaveLength(1);
    expect(all.length).toBe(2);
  });

  it.each([' , ,', 'not-a-fingerprint', 'AA:BB', 'undefined'])(
    'drops junk from the env (%s) instead of publishing it',
    (value) => {
      process.env.ANDROID_EXTRA_CERT_FINGERPRINTS = value;
      expect(androidFingerprints()).toHaveLength(1);
    }
  );

  it('accepts a lower-case fingerprint and normalises it', () => {
    const play =
      'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99';
    process.env.ANDROID_EXTRA_CERT_FINGERPRINTS = play;
    expect(androidFingerprints()).toContain(play.toUpperCase());
  });
});

describe('apple-app-site-association', () => {
  const OLD = process.env.IOS_APP_ID;
  afterEach(() => {
    if (OLD === undefined) delete process.env.IOS_APP_ID;
    else process.env.IOS_APP_ID = OLD;
  });

  it('has the shape iOS parses', () => {
    const aasa = appleAppSiteAssociation('ABCDE12345.uk.co.postra.app');
    expect(aasa.applinks.details[0].appIDs).toEqual([
      'ABCDE12345.uk.co.postra.app',
    ]);
    expect(aasa.applinks.details[0].components).toEqual([
      { '/': '/integrations/mobile-return' },
    ]);
  });

  /**
   * The team id was read off the Apple Developer account's Membership details
   * page on 2026-09-20 and hardcoded — it is published verbatim in this very
   * file, so it is not a secret. The bundle id half has moved once already
   * (`com.postra.app` turned out to be taken, E2E-10-46), which is the part
   * worth pinning: a stale one verifies nothing and says nothing.
   */
  it('serves the real team id and bundle id with no environment set', () => {
    delete process.env.IOS_APP_ID;
    expect(iosAppId()).toBe('5S47VS43RB.uk.co.postra.app');
  });

  it('ignores a blank override instead of turning the file off', () => {
    process.env.IOS_APP_ID = '   ';
    expect(iosAppId()).toBe('5S47VS43RB.uk.co.postra.app');
  });

  it('lets the environment override the team id, for a team that changed', () => {
    process.env.IOS_APP_ID = ' ABCDE12345.uk.co.postra.app ';
    expect(iosAppId()).toBe('ABCDE12345.uk.co.postra.app');
  });
});

/**
 * ⛔ The app opens `/auth/register` and `/auth/forgot` in the BROWSER on
 * purpose — registration is a web journey and the app is login-only in v1.
 * Claiming those paths would make the app swallow the very links it just asked
 * the browser to open, and the user would bounce back into the app on a screen
 * that cannot help them.
 */
describe('what the app is allowed to claim', () => {
  it('claims only the mobile OAuth return path', () => {
    expect(MOBILE_LINK_PATHS).toEqual(['/integrations/mobile-return']);
  });

  it.each(['/auth/register', '/auth/forgot', '/auth/login', '/launches', '/'])(
    'does not claim %s',
    (path) => {
      expect(MOBILE_LINK_PATHS).not.toContain(path);
    }
  );
});
