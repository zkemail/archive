import { NextResponse } from 'next/server';

import { getPublishedJwks } from '@/lib/statement';

/**
 * Verification keys for signed observation statements (REG-736).
 *
 * Reachable at the stable well-known path via the rewrite in next.config.ts:
 *   GET /.well-known/dkim-archive-jwks.json
 *
 * The set is served straight from the committed file, so the URL and the git
 * mirror can never drift. It is append-only: a retired kid stays published so
 * statements signed years ago remain verifiable.
 *
 * Deliberately not rate limited. Verification of an archived statement must
 * keep working for anyone, and the response is a small static document. A
 * consumer locked out of the key set cannot check evidence they already hold.
 */
export async function GET() {
  return NextResponse.json(getPublishedJwks(), {
    status: 200,
    headers: {
      'Content-Type': 'application/jwk-set+json',
      // Long-lived but revalidatable: the set only ever grows, and a stale copy
      // that is missing a freshly added kid must not be cached indefinitely.
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
