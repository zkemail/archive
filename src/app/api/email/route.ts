import { headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, rateLimited, serverError } from '@/lib/api-response';
import {
  checkClientRateLimit,
  CONTRIBUTE_BUDGET,
  resolveClientIdentity,
} from '@/lib/client-identity';
import { ingestEmail } from '@/lib/ingestEmail';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  headers: z
    .string()
    .min(1)
    .max(256 * 1024),
  timestamp: z.string().datetime().nullable(),
});

export async function POST(request: NextRequest) {
  const identity = await resolveClientIdentity(await headers());
  const limit = await checkClientRateLimit(identity, CONTRIBUTE_BUDGET);
  if (!limit.allowed) return rateLimited(limit);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid email headers');
  // This endpoint accepts headers only, never a mailbox body or attachment.
  if (/\r?\n\r?\n/.test(parsed.data.headers))
    return badRequest('Send headers only');
  try {
    const result = await ingestEmail(
      parsed.data.headers,
      parsed.data.timestamp ? new Date(parsed.data.timestamp) : null
    );
    return NextResponse.json(result, {
      status: result.signaturesFailed ? 503 : 200,
    });
  } catch (error) {
    logger.warn('email_ingestion_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError();
  }
}
