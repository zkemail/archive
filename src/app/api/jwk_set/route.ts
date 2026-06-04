import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { rateLimited, serverError } from '@/lib/api-response';
import {
  checkClientRateLimit,
  resolveClientIdentity,
} from '@/lib/client-identity';
import { getJWKeySetRecord } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function GET() {
  const hdrs = await headers();
  const identity = await resolveClientIdentity(hdrs);

  try {
    await checkClientRateLimit(identity);
  } catch {
    return rateLimited();
  }

  logger.info('api_request', {
    clientType: identity.type,
    clientId: identity.identifier,
    endpoint: 'jwk_set',
  });

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
