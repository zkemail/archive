import { type NextRequest, NextResponse } from 'next/server';

// Public API endpoints are consumed cross-origin by browser apps such as the
// zk.email registry (e.g. its DKIM check calls POST /api/dsp). Those requests
// are non-simple (JSON body / custom headers), so the browser fires a CORS
// preflight. Without an OPTIONS handler and CORS headers the preflight fails
// and the call is blocked.
//
// Auth here is header/IP based (x-api-key), never cookies, so a wildcard
// origin is safe: we never rely on credentialed requests. The x-api-key header
// must be whitelisted so authenticated callers still work under CORS.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  'Access-Control-Max-Age': '86400',
};

export function middleware(request: NextRequest) {
  // Answer the preflight directly with a 204 and the CORS headers.
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  // Attach CORS headers to the actual response so the browser exposes it.
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  // All public API routes except the cookie-based NextAuth handlers.
  matcher: ['/api/((?!auth).*)'],
};
