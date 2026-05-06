import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import {
  badRequest,
  rateLimited,
  serverError,
  validationError,
} from '@/lib/api-response';
import { logger } from '@/lib/logger';
import {
  addDomainSelectorPair,
  type AddResult,
  checkRateLimiter,
} from '@/lib/utilsServer';
import { type DspBody, dspBodySchema } from '@/lib/validation';

export type AddDspResponse = {
  message: DspBody;
  addResult?: AddResult;
};

const rateLimiter = new RateLimiterMemory({ points: 1200, duration: 360 });

export async function POST(request: NextRequest) {
  try {
    await checkRateLimiter(rateLimiter, await headers(), 1);
  } catch {
    return rateLimited();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const parsed = dspBodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { domain, selector } = parsed.data;

  try {
    const addResult = await addDomainSelectorPair(domain, selector, 'api');
    return NextResponse.json(
      { message: parsed.data, addResult } as AddDspResponse,
      { status: addResult.added ? 201 : 200 }
    );
  } catch (error) {
    logger.error('dsp_route_error', {
      error: error instanceof Error ? error.message : String(error),
      domain,
      selector,
    });
    return serverError();
  }
}
