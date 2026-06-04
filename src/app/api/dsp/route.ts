import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';

import {
  badRequest,
  rateLimited,
  serverError,
  validationError,
} from '@/lib/api-response';
import {
  checkClientRateLimit,
  resolveClientIdentity,
} from '@/lib/client-identity';
import { logger } from '@/lib/logger';
import { addDomainSelectorPair, type AddResult } from '@/lib/utilsServer';
import { type DspBody, dspBodySchema } from '@/lib/validation';

export type AddDspResponse = {
  message: DspBody;
  addResult?: AddResult;
};

export async function POST(request: NextRequest) {
  const hdrs = await headers();
  const identity = await resolveClientIdentity(hdrs);

  try {
    await checkClientRateLimit(identity);
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

  logger.info('api_request', {
    clientType: identity.type,
    clientId: identity.identifier,
    endpoint: 'dsp',
    domain: domain ?? undefined,
  });

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
