import { type NextRequest, NextResponse } from 'next/server';

import { findRecordsWithCache } from '@/lib/db';
import { logger } from '@/lib/logger';
import { addRateLimitHeaders, checkRateLimit } from '@/lib/rateLimit';
import type { DomainSearchResult } from '@/types/api';

/**
 * GET /api/key/domain
 * Search for DKIM records with LRU caching for improved performance
 *
 * Query Parameters:
 * - domain (required): Domain to search for
 * - selector (optional): Filter by specific selector
 *
 * This endpoint uses an in-memory LRU cache to reduce database load
 * for frequently accessed domains. Cache TTL is 30 minutes.
 */
export async function GET(
  request: NextRequest
): Promise<NextResponse<DomainSearchResult[] | { error: string }>> {
  // Apply rate limiting (higher limit for cached endpoint)
  const rateLimit = await checkRateLimit('keyDomain');
  if (!rateLimit.success) {
    return rateLimit.response!;
  }

  try {
    const { searchParams } = request.nextUrl;
    const domain = searchParams.get('domain');
    const selector = searchParams.get('selector') ?? undefined;

    // Validate required parameters
    if (!domain) {
      return NextResponse.json(
        { error: 'Missing required parameter: domain' },
        { status: 400 }
      );
    }

    // Validate domain format (basic check)
    if (domain.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(domain)) {
      return NextResponse.json(
        { error: 'Invalid domain format' },
        { status: 400 }
      );
    }

    // Validate selector format if provided
    if (
      selector &&
      (selector.length > 63 || !/^[a-zA-Z0-9._-]+$/.test(selector))
    ) {
      return NextResponse.json(
        { error: 'Invalid selector format' },
        { status: 400 }
      );
    }

    // Fetch records from cache or database
    const records = await findRecordsWithCache(domain, selector);

    // Transform to response format
    const result: DomainSearchResult[] = records.map((record) => ({
      domain: record.domainSelectorPair.domain,
      selector: record.domainSelectorPair.selector,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      value: record.value,
    }));

    logger.info('key_domain_search_completed', {
      domain,
      selector,
      resultCount: result.length,
      cached: true, // This endpoint always uses cache
    });

    const response = NextResponse.json(result, {
      status: 200,
      headers: {
        // Aggressive caching since this endpoint uses LRU cache
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });

    return addRateLimitHeaders(response, rateLimit);
  } catch (error) {
    logger.error('key_domain_search_failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
