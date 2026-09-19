import { NextResponse } from 'next/server';
import { assetLinks } from '../app-links';

// Reads an env var, so it must not be frozen into the build.
export const dynamic = 'force-dynamic';

/** Served at /.well-known/assetlinks.json (see the rewrite in next.config.js). */
export async function GET() {
  return NextResponse.json(assetLinks(), {
    headers: {
      'Content-Type': 'application/json',
      // Android re-checks periodically; an hour keeps a fingerprint change from
      // taking a day to take effect.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
