import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';

import {
  errorResponse,
  rateLimited,
  serverError,
  validationError,
} from '@/lib/api-response';
import {
  checkClientRateLimit,
  READ_BUDGET,
  resolveClientIdentity,
} from '@/lib/client-identity';
import { findRecordsWithCache } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  signStatementsForRecord,
  StatementSigningUnavailableError,
} from '@/lib/statement';
import { dspQueryRequiredSchema } from '@/lib/validation';

/**
 * Most keys under one (domain, selector) is a handful; the largest rotation
 * histories in the archive are far below this. The cap exists so an unusual or
 * deliberately inflated pair cannot make one request cost thousands of
 * signatures.
 */
const MAX_RECORDS_PER_REQUEST = 200;

/**
 * GET /api/key/statement?domain=<d>&selector=<s>
 *
 * Signed, offline-verifiable observation statements for one (domain, selector)
 * pair (REG-736). Returns a JSON array of compact JWS strings, one per stored
 * key value per signable observation channel, each naming its own `source`.
 * Only `live_dns` is signable; see SIGNABLE_SOURCES in lib/statement.ts.
 * Rotation history is preserved; the consumer picks the entry whose key
 * matches the signature they are checking.
 *
 * Statements are minted per request, not stored: the window they attest moves
 * whenever DNS is re-observed, so a persisted statement would be stale the
 * moment it was written.
 *
 * Verify against the published key set at
 * `/.well-known/dkim-archive-jwks.json`.
 *
 * Unlike /api/key this requires a selector: a statement attests one specific
 * (domain, selector, key) observation, and a domain-wide dump would sign an
 * unbounded set on one request.
 */
export async function GET(request: NextRequest) {
  const hdrs = await headers();
  const identity = await resolveClientIdentity(hdrs);

  const limit = await checkClientRateLimit(identity, READ_BUDGET);
  if (!limit.allowed) {
    return rateLimited(limit);
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = dspQueryRequiredSchema.safeParse(params);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { domain, selector } = parsed.data;

  logger.info('api_request', {
    clientType: identity.type,
    clientId: identity.identifier,
    endpoint: 'key_statement',
    domain,
  });

  try {
    const allRecords = await findRecordsWithCache(domain, selector);

    // Unlike the other read endpoints, a request here costs real CPU: one
    // Ed25519 signature per record per channel. Cap the work a single request
    // can buy so a pair that has accumulated an unusual number of key values
    // cannot turn one cheap GET into thousands of signatures and a multi-MB
    // body. Newest records first, since a consumer is matching against a
    // signature they hold now; the cap is far above any real rotation history.
    const records = allRecords
      .slice()
      .sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime())
      .slice(0, MAX_RECORDS_PER_REQUEST);

    if (allRecords.length > records.length) {
      logger.warn('statement_response_truncated', {
        domain,
        selector,
        total: allRecords.length,
        returned: records.length,
      });
    }

    // One issuance instant for the whole response, so the statements in a
    // single answer agree on when they were minted.
    const issuedAt = new Date();

    const statements = (
      await Promise.all(
        records.map((record) =>
          signStatementsForRecord(domain, selector, record, issuedAt)
        )
      )
    ).flat();

    return NextResponse.json(statements, {
      status: 200,
      headers: {
        // Every response carries a fresh `iat` and is signed over it, so a
        // cached copy is a different document than the one the next caller
        // would get.
        'Cache-Control': 'no-store',
        // Tell a consumer when they are not seeing the whole rotation history,
        // rather than letting a silent truncation read as "that is all of it".
        'X-Total-Records': String(allRecords.length),
        'X-Records-Truncated': String(allRecords.length > records.length),
      },
    });
  } catch (error) {
    if (error instanceof StatementSigningUnavailableError) {
      // Misconfiguration, not a client problem, and not something a retry
      // fixes. Say so plainly rather than emitting an unsigned fallback;
      // silently degrading would hand back something that looks like evidence.
      logger.error('statement_signing_unavailable', { error: error.message });
      return errorResponse(
        'signing_unavailable',
        'Statement signing is not configured on this deployment',
        503
      );
    }

    logger.error('key_statement_route_error', {
      error: error instanceof Error ? error.message : String(error),
      domain,
      selector,
    });
    return serverError();
  }
}
