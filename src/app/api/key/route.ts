import { type NextRequest, NextResponse } from 'next/server';

import { findRecords } from '@/lib/db';
import { logger } from '@/lib/logger';
import { addRateLimitHeaders, checkRateLimit } from '@/lib/rateLimit';
import type { DomainSearchResult } from '@/types/api';

/**
 * GET /api/key
 * Search for DKIM records by domain and optionally selector
 *
 * Query Parameters:
 * - domain (required): Domain to search for
 * - selector (optional): Filter by specific selector
 *
 * Returns array of DKIM records matching the query
 */
export async function GET(
  request: NextRequest
): Promise<NextResponse<DomainSearchResult[] | { error: string }>> {
  // Apply rate limiting
  const rateLimit = await checkRateLimit('key');
  if (!rateLimit.success) {
    return rateLimit.response!;
  }

  try {
    const { searchParams } = request.nextUrl;
    const domain = searchParams.get('domain');
    const selector = searchParams.get('selector');

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

    // Fetch records from database
    let records = await findRecords(domain);

    // Filter by selector if provided
    if (selector) {
      records = records.filter(
        (record) =>
          record.domainSelectorPair.selector.toLowerCase() ===
          selector.toLowerCase()
      );
    }

    // Transform to response format
    const result: DomainSearchResult[] = records.map((record) => ({
      domain: record.domainSelectorPair.domain,
      selector: record.domainSelectorPair.selector,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      value: record.value,
    }));

    logger.info('key_search_completed', {
      domain,
      selector: selector ?? undefined,
      resultCount: result.length,
    });

    const response = NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });

    return addRateLimitHeaders(response, rateLimit);
  } catch (error) {
    logger.error('key_search_failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
