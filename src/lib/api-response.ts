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

export function rateLimited() {
  return errorResponse('rate_limit_exceeded', 'Too many requests', 429);
}

export function serverError() {
  return errorResponse('internal_error', 'Internal server error', 500);
}

export function validationError(zodError: ZodError) {
  return badRequest('Invalid parameters', zodError.flatten().fieldErrors);
}
