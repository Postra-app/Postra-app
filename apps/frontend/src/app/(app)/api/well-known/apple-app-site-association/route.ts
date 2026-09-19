import { NextResponse } from 'next/server';
import { appleAppSiteAssociation, iosAppId } from '../app-links';

export const dynamic = 'force-dynamic';

/**
 * Served at /.well-known/apple-app-site-association (see next.config.js).
 *
 * ⚠️ No extension, so the content type has to be set here — iOS wants
 * `application/json` and Next would otherwise guess octet-stream.
 */
export async function GET() {
  const appId = iosAppId();
  if (!appId) {
    // Better a clean 404 than a file with the wrong team id: iOS caches AASA,
    // and a bad one keeps the app from claiming links until the cache expires.
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json(appleAppSiteAssociation(appId), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
