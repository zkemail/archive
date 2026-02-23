import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';

import { rateLimited, serverError, validationError } from '@/lib/api-response';
import {
  checkClientRateLimit,
  resolveClientIdentity,
} from '@/lib/client-identity';
import { findRecords } from '@/lib/db';
import { logger } from '@/lib/logger';
import { dspQuerySchema } from '@/lib/validation';

export type DomainSearchResults = {
  domain: string;
  selector: string;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  value: string;
};

export async function GET(request: NextRequest) {
  const hdrs = await headers();
  const identity = await resolveClientIdentity(hdrs);

  try {
    await checkClientRateLimit(identity);
  } catch {
    return rateLimited();
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
    let records = await findRecords(domain);

    // Filter by selector if provided
    if (selector) {
      records = records.filter(
        (record) => record.domainSelectorPair.selector === selector
      );
    }

    const result: DomainSearchResults[] = records.map((record) => ({
      domain: record.domainSelectorPair.domain,
      selector: record.domainSelectorPair.selector,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      value: record.value,
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
