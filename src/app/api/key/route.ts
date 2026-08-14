import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';

import { rateLimited, serverError, validationError } from '@/lib/api-response';
import {
  checkClientRateLimit,
  READ_BUDGET,
  resolveClientIdentity,
} from '@/lib/client-identity';
import { findRecordsWithCache } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  observationsForRecord,
  type ObservationSource,
  toRfc3339Utc,
} from '@/lib/statement';
import { dspQuerySchema } from '@/lib/validation';

/** One channel's observation window over a key value (REG-736). */
export type ObservationResult = {
  source: ObservationSource;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type DomainSearchResults = {
  domain: string;
  selector: string;
  /**
   * Union of every observation channel. Kept for backward compatibility and
   * for display; it deliberately mixes provenance, so it must not be used to
   * bound a key's validity. Use `observations` for that.
   */
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  value: string;
  /**
   * Opaque archive record id, stable across requests. Absent on a result that
   * is not an archive record yet: /api/key/domain also returns keys read live
   * from DNS during the request, before the write lands.
   */
  id?: number;
  /**
   * Per-channel windows, at most one entry per source. A key seen both in live
   * DNS and recovered via GCD carries two, each with its own window; neither
   * channel can move the other's. Empty when no window is attributable: a
   * handful of legacy records whose channels could not be disentangled.
   */
  observations: ObservationResult[];
};

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
    endpoint: 'key',
    domain: domain ?? undefined,
  });

  try {
    const records = await findRecordsWithCache(domain, selector || undefined);

    const result: DomainSearchResults[] = records.map((record) => ({
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

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error('key_route_error', {
      error: error instanceof Error ? error.message : String(error),
      domain,
      selector,
    });
    return serverError();
  }
}
