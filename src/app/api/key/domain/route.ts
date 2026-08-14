import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';

import { type DomainSearchResults } from '@/app/api/key/route';
import { rateLimited, serverError, validationError } from '@/lib/api-response';
import {
  checkClientRateLimit,
  READ_BUDGET,
  resolveClientIdentity,
} from '@/lib/client-identity';
import { findRecordsWithCache, type RecordWithSelector } from '@/lib/db';
import { logger } from '@/lib/logger';
import { observationsForRecord, toRfc3339Utc } from '@/lib/statement';
import { addDomainSelectorPair, fetchDkimDnsRecord } from '@/lib/utilsServer';
import { dspQuerySchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  const hdrs = await headers();
  const identity = await resolveClientIdentity(hdrs);

  const limit = await checkClientRateLimit(identity, READ_BUDGET);
  if (!limit.allowed) {
    return rateLimited(limit);
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = dspQuerySchema.safeParse(params);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { domain, selector } = parsed.data;

  logger.info('api_request', {
    clientType: identity.type,
    clientId: identity.identifier,
    endpoint: 'key/domain',
    domain: domain ?? undefined,
  });

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
      id: record.id,
      observations: observationsForRecord(record).map((observation) => ({
        source: observation.source,
        firstSeenAt: toRfc3339Utc(observation.firstSeenAt),
        lastSeenAt: toRfc3339Utc(observation.lastSeenAt),
      })),
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
          // No `id`: this key was just read from DNS and the archive write is
          // still in flight below. It is a genuine live-DNS sighting though,
          // so it carries the matching single-instant observation.
          observations: [
            {
              source: 'live_dns' as const,
              firstSeenAt: toRfc3339Utc(record.timestamp),
              lastSeenAt: toRfc3339Utc(record.timestamp),
            },
          ],
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
