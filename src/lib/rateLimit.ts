import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

/**
 * Rate limit configurations for different API endpoints
 * Adjust these values based on expected traffic patterns
 */
export const RATE_LIMITS = {
  // Public endpoints - moderate limits
  dsp: { points: 1200, duration: 360, blockDuration: 60 }, // ~3.33 req/sec
  jwkSet: { points: 5, duration: 10, blockDuration: 30 }, // 0.5 req/sec

  // Search endpoints - higher limits for good UX
  key: { points: 1000, duration: 1, blockDuration: 10 }, // 1000 req/sec
  keyDomain: { points: 2000, duration: 1, blockDuration: 10 }, // 2000 req/sec

  // Auth endpoints - strict limits to prevent abuse
  auth: { points: 10, duration: 60, blockDuration: 300 }, // 10 req/min

  // Gmail processing - moderate limits
  gmail: { points: 100, duration: 60, blockDuration: 60 }, // 100 req/min

  // Batch operations - very limited
  batch: { points: 10, duration: 3600, blockDuration: 300 }, // 10 req/hour

  // Default fallback
  default: { points: 100, duration: 60, blockDuration: 60 },
} as const;

export type RateLimitKey = keyof typeof RATE_LIMITS;

/**
 * Singleton storage for rate limiters
 * Each endpoint gets its own limiter instance
 */
const limiters = new Map<RateLimitKey, RateLimiterMemory>();

/**
 * Get or create a rate limiter for the specified key
 */
function getLimiter(key: RateLimitKey): RateLimiterMemory {
  if (!limiters.has(key)) {
    limiters.set(key, new RateLimiterMemory(RATE_LIMITS[key]));
  }
  return limiters.get(key)!;
}

/**
 * Extract client IP address from request headers
 * Checks multiple headers in order of preference
 */
export function getClientIp(headersList: Headers): string {
  // Cloudflare
  const cfConnectingIp = headersList.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }

  // Standard proxy headers
  const forwardedFor = headersList.get('x-forwarded-for');
  if (forwardedFor) {
    // Take the first IP in the chain (original client)
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = headersList.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  // Vercel-specific
  const vercelForwardedFor = headersList.get('x-vercel-forwarded-for');
  if (vercelForwardedFor) {
    return vercelForwardedFor.split(',')[0].trim();
  }

  // Fallback for local development
  return '127.0.0.1';
}

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  response?: NextResponse;
}

/**
 * Check if a request should be rate limited
 *
 * @param key - The rate limit configuration key to use
 * @param points - Number of points to consume (default: 1)
 * @returns RateLimitResult with success status and optional error response
 */
export async function checkRateLimit(
  key: RateLimitKey,
  points: number = 1
): Promise<RateLimitResult> {
  const headersList = await headers();
  const clientIp = getClientIp(headersList);
  const limiter = getLimiter(key);
  const config = RATE_LIMITS[key];

  try {
    const result = await limiter.consume(clientIp, points);

    return {
      success: true,
      limit: config.points,
      remaining: result.remainingPoints,
      resetAt: new Date(Date.now() + result.msBeforeNext),
    };
  } catch (error) {
    const rateLimitError = error as RateLimiterRes;
    const resetAt = new Date(Date.now() + rateLimitError.msBeforeNext);
    const retryAfter = Math.ceil(rateLimitError.msBeforeNext / 1000);

    return {
      success: false,
      limit: config.points,
      remaining: 0,
      resetAt,
      response: NextResponse.json(
        {
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_ERROR',
          retryAfter,
          resetAt: resetAt.toISOString(),
        },
        {
          status: 429,
          headers: {
            'Retry-After': retryAfter.toString(),
            'X-RateLimit-Limit': config.points.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': resetAt.toISOString(),
          },
        }
      ),
    };
  }
}

/**
 * Add rate limit headers to a successful response
 */
export function addRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult
): NextResponse {
  response.headers.set('X-RateLimit-Limit', result.limit.toString());
  response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
  response.headers.set('X-RateLimit-Reset', result.resetAt.toISOString());
  return response;
}

/**
 * Create a rate-limited response with proper headers
 */
export function createRateLimitedResponse<T>(
  data: T,
  result: RateLimitResult,
  status: number = 200
): NextResponse {
  const response = NextResponse.json(data, { status });
  return addRateLimitHeaders(response, result);
}

/**
 * Legacy helper for compatibility with older code patterns
 * Throws on rate limit exceeded
 */
export async function checkRateLimiterLegacy(
  limiter: RateLimiterMemory,
  headersList: Headers,
  points: number
): Promise<void> {
  const clientIp = getClientIp(headersList);
  await limiter.consume(clientIp, points);
}

/**
 * Get rate limit status without consuming points
 * Useful for checking remaining capacity
 */
export async function getRateLimitStatus(
  key: RateLimitKey
): Promise<{ remaining: number; resetAt: Date } | null> {
  const headersList = await headers();
  const clientIp = getClientIp(headersList);
  const limiter = getLimiter(key);

  try {
    const result = await limiter.get(clientIp);
    if (!result) {
      return {
        remaining: RATE_LIMITS[key].points,
        resetAt: new Date(Date.now() + RATE_LIMITS[key].duration * 1000),
      };
    }

    return {
      remaining: result.remainingPoints,
      resetAt: new Date(Date.now() + result.msBeforeNext),
    };
  } catch {
    return null;
  }
}

/**
 * Reset rate limit for a specific client (for admin/testing)
 */
export async function resetRateLimit(
  key: RateLimitKey,
  clientIp?: string
): Promise<void> {
  const ip = clientIp ?? getClientIp(await headers());
  const limiter = getLimiter(key);
  await limiter.delete(ip);
}
