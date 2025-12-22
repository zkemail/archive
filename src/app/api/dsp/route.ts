import { headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { z } from 'zod';

import { logger } from '@/lib/logger';
import { checkRateLimiter } from '@/lib/utils';
import { addDomainSelectorPair, type AddResult } from '@/lib/utils_server';

export type AddDspResponse = {
  message: object;
  addResult?: AddResult;
};

const AddDspRequestSchema = z.object({
  domain: z.string(),
  selector: z.string(),
});

export type AddDspRequest = z.infer<typeof AddDspRequestSchema>;

const rateLimiter = new RateLimiterMemory({ points: 1200, duration: 360 });

export async function POST(request: NextRequest) {
  try {
    await checkRateLimiter(rateLimiter, await headers(), 1);
  } catch {
    logger.warn('rate_limit_exceeded', { endpoint: '/api/dsp' });
    return NextResponse.json('Rate limit exceeded', { status: 429 });
  }

  try {
    const body = await request.json();
    const dsp = AddDspRequestSchema.parse(body);

    logger.info('dsp_add_request', {
      domain: dsp.domain,
      selector: dsp.selector,
    });

    const addResult = await addDomainSelectorPair(
      dsp.domain,
      dsp.selector,
      'api'
    );

    logger.info('dsp_add_result', {
      domain: dsp.domain,
      selector: dsp.selector,
      added: addResult.added,
      alreadyInDb: addResult.already_in_db,
    });

    return NextResponse.json({ message: dsp, addResult } as AddDspResponse, {
      status: addResult.added ? 201 : 200,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('dsp_validation_error', { errors: error.issues });
      return NextResponse.json(error.issues, { status: 400 });
    }

    logger.error('dsp_add_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      error instanceof Error ? error.message : String(error),
      { status: 500 }
    );
  }
}
