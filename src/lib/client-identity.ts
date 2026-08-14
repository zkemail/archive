import crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import type { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers';
import { RateLimiterMemory, type RateLimiterRes } from 'rate-limiter-flexible';

import type { ApiKey } from '@/generated/prisma/client';

import { prisma } from './db';
import { getClientIp } from './utilsServer';

// ─── Budgets ─────────────────────────────────────────────────────────────────

/** A points-per-window allowance. Routes pick one; see REG-748. */
export type RateBudget = { points: number; durationSeconds: number };

/** Reads. Deliberately tight; the previous allowance was 100 req/sec. */
export const READ_BUDGET: RateBudget = { points: 10, durationSeconds: 60 };

/**
 * Contribution. `submitPairs` in the contribute page issues one sequential
 * POST /api/dsp per extracted domain/selector pair, and a mailbox upload
 * routinely yields hundreds, so this cannot share the read budget.
 *
 * The number is set from measurement, not taste. Against the production
 * database, /api/dsp settles at ~0.146s per call once warm, so a sequential
 * client achieves ~410 req/min, and production will be faster still because the
 * app sits closer to the database than a laptop does. A 300/min budget (the
 * first value tried) failed a legitimate upload after ~44 seconds. This leaves
 * roughly 3x headroom over the measured ceiling while still cutting the old
 * 100 req/sec allowance by 5x.
 *
 * Lowering this is a follow-up: batching the uploader into one request instead
 * of N would remove the need for a large budget entirely.
 */
export const CONTRIBUTE_BUDGET: RateBudget = {
  points: 1200,
  durationSeconds: 60,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClientIdentity = {
  type: 'api_key' | 'origin' | 'ip';
  /** Human-facing label: key name, origin string, or IP. Used for logging. */
  identifier: string;
  /**
   * What the rate limiter counts against. For anonymous callers this is the
   * client IP rather than the origin, so that one busy caller cannot consume
   * the allowance belonging to everyone else on the same site. `identifier`
   * still records the origin, which is useful for logging.
   */
  rateLimitKey: string;
  /** req/sec, api_key callers only. Absent means "use the route's budget". */
  apiKeyRateLimit?: number;
};

export type RateLimitResult =
  | { allowed: true }
  | {
      allowed: false;
      limit: number;
      windowSeconds: number;
      retryAfterSeconds: number;
    };

// ─── API Key Cache ────────────────────────────────────────────────────────────

const apiKeyCache = new LRUCache<string, ApiKey>({
  max: 200,
  ttl: 5 * 60 * 1000, // 5 minutes
});

function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

async function lookupApiKey(rawKey: string): Promise<ApiKey | null> {
  const hash = hashApiKey(rawKey);

  const cached = apiKeyCache.get(hash);
  if (cached) return cached;

  const record = await prisma.apiKey.findFirst({
    where: { keyHash: hash, isActive: true },
  });

  if (!record) return null;

  apiKeyCache.set(hash, record);

  // Fire-and-forget: update lastUsedAt
  prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {
      // Ignore errors — this is best-effort
    });

  return record;
}

// ─── Rate Limiters ────────────────────────────────────────────────────────────

// One limiter per budget, each holding many client keys internally with
// automatic expiry. Replaces a per-client Map that was both redundant and
// unbounded (REG-748).
const limitersByBudget = new Map<RateBudget, RateLimiterMemory>();

function limiterForBudget(budget: RateBudget): RateLimiterMemory {
  const existing = limitersByBudget.get(budget);
  if (existing) return existing;

  const limiter = new RateLimiterMemory({
    points: budget.points,
    duration: budget.durationSeconds,
  });
  limitersByBudget.set(budget, limiter);
  return limiter;
}

// API keys carry their own per-second rate, so they cannot share a limiter.
// Bounded, mirroring apiKeyCache above.
const apiKeyLimiters = new LRUCache<string, RateLimiterMemory>({ max: 200 });

function limiterForApiKey(name: string, rateLimit: number): RateLimiterMemory {
  const existing = apiKeyLimiters.get(name);
  if (existing) return existing;

  const limiter = new RateLimiterMemory({
    points: rateLimit,
    duration: 1, // per second, unchanged from the original semantics
  });
  apiKeyLimiters.set(name, limiter);
  return limiter;
}

// ─── Origin Extraction ────────────────────────────────────────────────────────

function extractOrigin(headers: ReadonlyHeaders): string | null {
  const origin = headers.get('origin');
  if (origin) return origin.trim();

  const referer = headers.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Invalid URL — ignore
    }
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolves the client identity from request headers.
 * Priority: api_key > origin > ip
 */
export async function resolveClientIdentity(
  headers: ReadonlyHeaders
): Promise<ClientIdentity> {
  // 1. API key
  const rawKey = headers.get('x-api-key');
  if (rawKey) {
    const record = await lookupApiKey(rawKey);
    if (record) {
      return {
        type: 'api_key',
        identifier: record.name,
        rateLimitKey: `key:${record.name}`,
        apiKeyRateLimit: record.rateLimit,
      };
    }
    // Invalid key: fall through to origin / IP
  }

  // 2 & 3. Anonymous. See ClientIdentity.rateLimitKey for what is counted.
  const ip = getClientIp(headers);
  const origin = extractOrigin(headers);

  return origin
    ? { type: 'origin', identifier: origin, rateLimitKey: ip }
    : { type: 'ip', identifier: ip, rateLimitKey: ip };
}

/**
 * Consumes one point against this client's budget.
 *
 * An api_key caller uses its own configured req/sec and ignores `budget`.
 * Everyone else is counted per IP against the route's budget.
 *
 * Returns a decision rather than throwing: being rate limited is an expected
 * outcome, and the caller needs the numbers to build a useful 429.
 */
export async function checkClientRateLimit(
  identity: ClientIdentity,
  budget: RateBudget
): Promise<RateLimitResult> {
  const isApiKey =
    identity.type === 'api_key' && identity.apiKeyRateLimit !== undefined;

  const effective: RateBudget = isApiKey
    ? { points: identity.apiKeyRateLimit!, durationSeconds: 1 }
    : budget;

  const limiter = isApiKey
    ? limiterForApiKey(identity.identifier, identity.apiKeyRateLimit!)
    : limiterForBudget(budget);

  try {
    await limiter.consume(identity.rateLimitKey, 1);
    return { allowed: true };
  } catch (rejection) {
    // rate-limiter-flexible rejects with a RateLimiterRes when the limit is
    // hit, and with a real Error only when the store itself failed. Do not
    // swallow the latter as a 429.
    if (rejection instanceof Error) throw rejection;

    const msBeforeNext = (rejection as RateLimiterRes)?.msBeforeNext ?? 0;
    return {
      allowed: false,
      limit: effective.points,
      windowSeconds: effective.durationSeconds,
      retryAfterSeconds: Math.max(1, Math.ceil(msBeforeNext / 1000)),
    };
  }
}
