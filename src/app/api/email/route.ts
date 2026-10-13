import { headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, rateLimited } from '@/lib/api-response';
import {
  checkClientRateLimit,
  CONTRIBUTE_BUDGET,
  resolveClientIdentity,
} from '@/lib/client-identity';
import { ingestSignatureEvidence } from '@/lib/ingestEmail';
import { logger } from '@/lib/logger';
import { domainSchema } from '@/lib/validation';

// One bounded record per request: no arbitrary per-message signature cap.
const MAX_EVIDENCE_BYTES = 8192;
const bodySchema = z
  .object({
    domain: domainSchema,
    selector: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9_.-]+$/),
    headerHash: z.string().regex(/^[a-f0-9]+$/),
    dkimSignature: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[A-Za-z0-9+/\t \r\n]+={0,2}$/),
    signingAlgorithm: z.enum(['rsa-sha256', 'rsa-sha1', 'rsa-sha512']),
    timestamp: z.string().datetime().nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.headerHash.length ===
      {
        'rsa-sha1': 40,
        'rsa-sha256': 64,
        'rsa-sha512': 128,
      }[value.signingAlgorithm]
  );

export async function POST(request: NextRequest) {
  const identity = await resolveClientIdentity(await headers());
  const limit = await checkClientRateLimit(identity, CONTRIBUTE_BUDGET);
  if (!limit.allowed) return rateLimited(limit);
  let body: unknown;
  try {
    // Bound bytes while reading, including chunked requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return badRequest('Missing evidence body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_EVIDENCE_BYTES) {
        await reader.cancel();
        return badRequest('Evidence body too large');
      }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return badRequest('Invalid JSON body');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid signature evidence');
  try {
    const result = await ingestSignatureEvidence(
      parsed.data,
      parsed.data.timestamp ? new Date(parsed.data.timestamp) : null
    );
    return NextResponse.json(result);
  } catch (error) {
    logger.warn('email_ingestion_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Signature could not be saved' },
      { status: 503 }
    );
  }
}
