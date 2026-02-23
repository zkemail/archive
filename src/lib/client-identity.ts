import crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import type { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import type { ApiKey } from '@/generated/prisma/client';

import { prisma } from './db';
import { getClientIp } from './utils_server';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_RATE_LIMIT = 100; // req/sec for anonymous origin / IP callers

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClientIdentity = {
  type: 'api_key' | 'origin' | 'ip';
  identifier: string; // key name, origin string, or IP
  rateLimit: number; // req/sec for this client
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

// ─── Per-Client Rate Limiters ─────────────────────────────────────────────────

const clientLimiters = new Map<string, RateLimiterMemory>();

function getLimiter(clientId: string, rateLimit: number): RateLimiterMemory {
  const existing = clientLimiters.get(clientId);
  if (existing) return existing;

  const limiter = new RateLimiterMemory({
    points: rateLimit,
    duration: 1, // per second
    keyPrefix: clientId,
  });
  clientLimiters.set(clientId, limiter);
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
        rateLimit: record.rateLimit,
      };
    }
    // Invalid key: fall through to origin / IP
  }

  // 2. Origin header
  const origin = extractOrigin(headers);
  if (origin) {
    return {
      type: 'origin',
      identifier: origin,
      rateLimit: DEFAULT_RATE_LIMIT,
    };
  }

  // 3. IP fallback
  const ip = getClientIp(headers);
  return {
    type: 'ip',
    identifier: ip,
    rateLimit: DEFAULT_RATE_LIMIT,
  };
}

/**
 * Consumes 1 point from this client's per-client rate limiter.
 * Throws RateLimiterRes if the limit is exceeded.
 */
export async function checkClientRateLimit(
  identity: ClientIdentity
): Promise<void> {
  const limiter = getLimiter(identity.identifier, identity.rateLimit);
  await limiter.consume(identity.identifier, 1);
}
