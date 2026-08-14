import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export type ApiError = {
  error: string;
  message: string;
  details?: unknown;
};

export function errorResponse(
  error: string,
  message: string,
  status: number,
  details?: unknown
) {
  const body: ApiError = { error, message };
  if (details) body.details = details;
  return NextResponse.json(body, { status });
}

export function badRequest(message: string, details?: unknown) {
  return errorResponse('bad_request', message, 400, details);
}

/**
 * Where a throttled caller should go to get real access. The 429 carries this
 * rather than a bare "Too many requests", so a legitimate high-volume user is
 * told what to do instead of being left to guess or to retry forever.
 */
export const API_ACCESS_CONTACT = 'support@zk.email';

export function rateLimited(result: {
  limit: number;
  windowSeconds: number;
  retryAfterSeconds: number;
}) {
  const body: ApiError = {
    error: 'rate_limit_exceeded',
    message:
      `Rate limit exceeded: ${result.limit} requests per ${result.windowSeconds}s per IP. ` +
      `For bulk, commercial or enterprise use, request an API key: ${API_ACCESS_CONTACT}`,
    details: {
      limit: result.limit,
      windowSeconds: result.windowSeconds,
      retryAfterSeconds: result.retryAfterSeconds,
    },
  };

  // Built directly rather than through errorResponse(), which cannot set
  // headers. Retry-After lets a well-behaved client back off on its own.
  return NextResponse.json(body, {
    status: 429,
    headers: { 'Retry-After': String(result.retryAfterSeconds) },
  });
}

export function serverError() {
  return errorResponse('internal_error', 'Internal server error', 500);
}

export function validationError(zodError: ZodError) {
  return badRequest('Invalid parameters', zodError.flatten().fieldErrors);
}
