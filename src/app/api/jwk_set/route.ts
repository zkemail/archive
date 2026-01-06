import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import { rateLimited, serverError } from '@/lib/api-response';
import { getJWKeySetRecord } from '@/lib/db';
import { logger } from '@/lib/logger';
import { checkRateLimiter } from '@/lib/utilsServer';

const rateLimiter = new RateLimiterMemory({ points: 5, duration: 10 });

export async function GET() {
  try {
    await checkRateLimiter(rateLimiter, await headers(), 1);
  } catch {
    return rateLimited();
  }

  try {
    const JwkSet = await getJWKeySetRecord();
    return NextResponse.json(JwkSet, { status: 200 });
  } catch (error) {
    logger.error('jwk_set_route_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError();
  }
}
