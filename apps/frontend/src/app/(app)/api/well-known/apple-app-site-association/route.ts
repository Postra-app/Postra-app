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
  return NextResponse.json(appleAppSiteAssociation(iosAppId()), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
