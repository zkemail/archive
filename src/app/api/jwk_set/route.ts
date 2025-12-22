import { NextResponse } from 'next/server';

import { getJWKeySetRecord } from '@/lib/db';
import { logger } from '@/lib/logger';
import { addRateLimitHeaders, checkRateLimit } from '@/lib/rateLimit';
import type { JwkSetRecord } from '@/types/api';

/**
 * GET /api/jwk_set
 * Retrieve stored JSON Web Key Sets for JWT verification
 *
 * Returns all JWK set records stored in the database
 * These are typically Google's OAuth JWKs used for token verification
 */
export async function GET(): Promise<
  NextResponse<JwkSetRecord[] | { error: string }>
> {
  // Apply strict rate limiting for this endpoint
  const rateLimit = await checkRateLimit('jwkSet');
  if (!rateLimit.success) {
    return rateLimit.response!;
  }

  try {
    const jwkSetRecords = await getJWKeySetRecord();

    logger.info('jwk_set_retrieved', {
      recordCount: jwkSetRecords.length,
    });

    const response = NextResponse.json(jwkSetRecords, {
      status: 200,
      headers: {
        // Cache for longer since JWKs don't change frequently
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });

    return addRateLimitHeaders(response, rateLimit);
  } catch (error) {
    logger.error('jwk_set_retrieval_failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
