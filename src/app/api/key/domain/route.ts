import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import { type DomainSearchResults } from '@/app/api/key/route';
import { rateLimited, serverError, validationError } from '@/lib/api-response';
import { findRecordsWithCache, type RecordWithSelector } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  addDomainSelectorPair,
  checkRateLimiter,
  fetchDkimDnsRecord,
} from '@/lib/utilsServer';
import { dspQuerySchema } from '@/lib/validation';

const rateLimiter = new RateLimiterMemory({ points: 2000, duration: 1 });

export async function GET(request: NextRequest) {
  try {
    await checkRateLimiter(rateLimiter, await headers(), 1);
  } catch {
    return rateLimited();
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = dspQuerySchema.safeParse(params);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { domain, selector } = parsed.data;

  try {
    // Fetch from database
    let dbRecords: RecordWithSelector[] = [];
    try {
      dbRecords = await findRecordsWithCache(domain, selector);
    } catch (dbError) {
      logger.error('domain_route_db_error', {
        error: dbError instanceof Error ? dbError.message : String(dbError),
        domain,
        selector,
      });
      return serverError();
    }

    // Convert DB records to result format
    const dbResults: DomainSearchResults[] = dbRecords.map((record) => ({
      domain: record.domainSelectorPair.domain,
      selector: record.domainSelectorPair.selector,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      value: record.value,
    }));

    // If selector is provided, also fetch from DNS
    let dnsResults: DomainSearchResults[] = [];
    if (selector) {
      try {
        const dnsRecords = await fetchDkimDnsRecord(domain, selector);
        dnsResults = dnsRecords.map((record) => ({
          domain: record.domain,
          selector: record.selector,
          firstSeenAt: record.timestamp,
          lastSeenAt: record.timestamp,
          value: record.value,
        }));

        // Async call to add DSP to database (fire and forget)
        if (dnsRecords.length > 0) {
          addDomainSelectorPair(domain, selector, 'api').catch((err) => {
            logger.error('domain_route_dsp_add_failed', {
              error: err instanceof Error ? err.message : String(err),
              domain,
              selector,
            });
          });
        }
      } catch (dnsError) {
        logger.warn('domain_route_dns_error', {
          error:
            dnsError instanceof Error ? dnsError.message : String(dnsError),
          domain,
          selector,
        });
        // Continue with DB results only
      }
    }

    // Combine results, avoiding duplicates based on value
    const seenValues = new Set(dbResults.map((r) => r.value));
    const combinedResults = [
      ...dbResults,
      ...dnsResults.filter((r) => !seenValues.has(r.value)),
    ];

    return NextResponse.json(combinedResults, { status: 200 });
  } catch (error) {
    logger.error('key_route_error', {
      error: error instanceof Error ? error.message : String(error),
      domain,
      selector,
    });
    return serverError();
  }
}
