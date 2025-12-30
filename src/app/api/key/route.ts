import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { z } from 'zod';

import { rateLimited, serverError, validationError } from '@/lib/api-response';
import { findRecords } from '@/lib/db';
import { logger } from '@/lib/logger';
import { checkRateLimiter } from '@/lib/utils_server';

export type RecordSource = 'dns' | 'database' | 'both';

export type DomainSearchResults = {
  domain: string;
  selector: string;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  value: string;
};

const querySchema = z.object({
  domain: z
    .string()
    .min(1, 'domain is required')
    .max(253)
    .regex(
      /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z0-9-]{1,63})*$/,
      'invalid domain format'
    ),
  selector: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-zA-Z0-9_-]+$/, 'invalid selector format')
    .optional(),
});

const rateLimiter = new RateLimiterMemory({ points: 1000, duration: 1 });

export async function GET(request: NextRequest) {
  try {
    await checkRateLimiter(rateLimiter, await headers(), 1);
  } catch (error) {
    return rateLimited();
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(params);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { domain, selector } = parsed.data;

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
  } catch (error: any) {
    logger.error('key_route_error', {
      error: error instanceof Error ? error.message : String(error),
      domain,
      selector,
    });
    return serverError();
  }
}
