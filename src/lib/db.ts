import { PrismaPg } from '@prisma/adapter-pg';
import { LRUCache } from 'lru-cache';
import { Pool } from 'pg';

import {
  type DkimRecord,
  type DomainSelectorPair,
  Prisma,
  PrismaClient,
} from '@/generated/prisma/client';

import { logger } from './logger';
import { DnsDkimFetchResult, fetchJsonWebKeySet, fetchx509Cert } from './utils';

// In process Cache configuration (LRU cache)
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const CACHE_MAX_SIZE = 1000; // Maximum 1000 entries

// Create LRU cache instances
const domainCache = new LRUCache<string, RecordWithSelector[]>({
  max: CACHE_MAX_SIZE,
  ttl: CACHE_TTL,
});

const domainSelectorCache = new LRUCache<string, RecordWithSelector[]>({
  max: CACHE_MAX_SIZE,
  ttl: CACHE_TTL,
});

// Cache for DomainSelectorPair IDs to avoid repeated lookups
const DSP_ID_CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day
const dspIdCache = new LRUCache<string, number>({
  max: CACHE_MAX_SIZE,
  ttl: DSP_ID_CACHE_TTL,
});

// Stats cache (10 min TTL)
export type ArchiveStats = {
  uniqueDomains: number;
  uniqueSelectors: number;
  domainSelectorPairs: number;
  dkimKeys: number;
};
const STATS_CACHE_TTL = 10 * 60 * 1000;
const statsCache = new LRUCache<string, ArchiveStats>({
  max: 1,
  ttl: STATS_CACHE_TTL,
});

const createPrismaClient = () => {
  // Create a pg Pool with optimized connection settings
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20, // Max connections
    idleTimeoutMillis: 30000, // 30 seconds idle timeout
    connectionTimeoutMillis: 10000, // 10 seconds connection timeout
    // Render's NAT closes idle sockets aggressively. Without keepAlive
    // every first-request-after-idle pays a full TCP+TLS handshake
    // (~150-400ms cross-cloud) before the query even starts.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    // Hard cap on any single statement. Generous initial value picked to
    // accommodate the pre-trigram-index baseline (page-1 search measured
    // 60-90s before REG-701 lands). Once healthy query latency settles
    // below 100ms, ratchet this down in steps (60s, then 30s, then 10s)
    // so a true runaway can't hold a pool slot indefinitely.
    statement_timeout: 90000,
    // Distinguishes our queries from the legacy archive's in
    // pg_stat_activity so we can attribute load on the shared instance.
    application_name: 'archive-new',
  });

  // Create the Prisma adapter with the pool
  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter });
};

declare global {
  var prismaClient: undefined | ReturnType<typeof createPrismaClient>;
}
export const prisma = globalThis.prismaClient ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaClient = prisma;
}

export type RecordWithSelector = DkimRecord & {
  domainSelectorPair: DomainSelectorPair;
};

export async function findRecords(
  domainQuery: string
): Promise<RecordWithSelector[]> {
  return await prisma.dkimRecord.findMany({
    where: {
      domainSelectorPair: {
        OR: [
          {
            domain: {
              equals: domainQuery,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            domain: {
              endsWith: '.' + domainQuery,
              mode: Prisma.QueryMode.insensitive,
            },
          },
        ],
      },
      value: {
        not: {
          equals: 'p=',
        },
      },
    },
    include: {
      domainSelectorPair: true,
    },
  });
}

export function dspToString(dsp: DomainSelectorPair): string {
  return `#${dsp.id}, ${dsp.domain}, ${dsp.selector}`;
}

export function recordToString(record: DkimRecord): string {
  const value = record.value;
  const maxLen = 50;
  const valueTruncated =
    value.length > maxLen ? value.slice(0, maxLen - 1) + '…' : value;
  return `#${record.id}, "${valueTruncated}"`;
}

export async function updateDspTimestamp(
  dsp: DomainSelectorPair,
  timestamp: Date
) {
  await prisma.domainSelectorPair.update({
    where: {
      id: dsp.id,
    },
    data: {
      lastRecordUpdate: timestamp,
    },
  });

  clearRecordsCache(dsp.domain, dsp.selector);
}

export async function createDkimRecord(
  dsp: DomainSelectorPair,
  dkimDsnRecord: DnsDkimFetchResult
) {
  const dkimRecord = await prisma.dkimRecord.create({
    data: {
      domainSelectorPairId: dsp.id,
      value: dkimDsnRecord.value,
      firstSeenAt: dkimDsnRecord.timestamp,
      lastSeenAt: dkimDsnRecord.timestamp,
      keyType: dkimDsnRecord.keyType,
      keyData: dkimDsnRecord.keyDataBase64,
    },
  });

  clearRecordsCache(dsp.domain, dsp.selector);

  logger.info('dkim_record_created', {
    recordId: dkimRecord.id,
    domain: dsp.domain,
    selector: dsp.selector,
    keyType: dkimDsnRecord.keyType,
  });

  return dkimRecord;
}

export async function getLastJWKeySet() {
  try {
    const lastJwtKey = await prisma.jsonWebKeySets.findFirst({
      orderBy: {
        lastUpdated: 'desc',
      },
    });

    return lastJwtKey;
  } catch (error) {
    logger.error('jwk_fetch_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateJWKeySet() {
  try {
    const lastJWKeySet = await getLastJWKeySet();
    const latestx509Cert = await fetchx509Cert();
    const latestJsonWebKeySet = await fetchJsonWebKeySet();
    if (latestx509Cert == '' || latestJsonWebKeySet == '') {
      logger.error('jwk_update_failed', { reason: 'empty_keys' });
      return;
    }
    if (lastJWKeySet?.x509Certificate != latestx509Cert) {
      return await prisma.jsonWebKeySets.create({
        data: {
          jwks: latestJsonWebKeySet,
          x509Certificate: latestx509Cert,
        },
      });
    } else {
      return await prisma.jsonWebKeySets.update({
        where: {
          id: lastJWKeySet.id,
        },
        data: {
          lastUpdated: new Date(),
        },
      });
    }
  } catch (error) {
    logger.error('jwk_update_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getJWKeySetRecord() {
  const jwkSetRecord = await prisma.jsonWebKeySets.findMany();
  return jwkSetRecord;
}

// Helper function to generate cache keys
function generateCacheKey(domain: string, selector?: string): string {
  return selector ? `${domain}:${selector}` : domain;
}

const inFlightRequests = new Map<string, Promise<RecordWithSelector[]>>();

export async function findRecordsWithCache(
  domain: string,
  selector?: string
): Promise<RecordWithSelector[]> {
  // Normalize inputs to lowercase
  const domainNorm = domain.toLowerCase();
  const selectorNorm = selector?.toLowerCase();

  const cacheKey = generateCacheKey(domainNorm, selectorNorm);
  const cache = selector ? domainSelectorCache : domainCache;

  // Try to get from cache first
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  // De-duplicate concurrent misses
  const inflight = inFlightRequests.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  // Cache miss: fetch from database

  const p = (async () => {
    // Minimal timing to avoid console overhead in hot path

    if (selectorNorm) {
      // STEP 1: Try in-memory DSP id cache first
      const dspIdKey = generateCacheKey(domainNorm, selectorNorm);
      let dspId = dspIdCache.get(dspIdKey);
      if (!dspId) {
        const dsp = await prisma.domainSelectorPair.findFirst({
          where: { domain: domainNorm, selector: selectorNorm },
          select: { id: true },
        });
        if (!dsp) {
          cache.set(cacheKey, []);
          return [];
        }
        dspId = dsp.id;
        dspIdCache.set(dspIdKey, dspId);
      }

      // STEP 2: Get DkimRecords by ID
      const dkimRecords = await prisma.dkimRecord.findMany({
        where: { domainSelectorPairId: dspId },
        select: { firstSeenAt: true, lastSeenAt: true, value: true },
      });

      // Filter and combine (use normalized domain/selector)
      const filtered = dkimRecords.filter((record) => record.value !== 'p=');
      const result = filtered.map((record) => ({
        ...record,
        domainSelectorPair: { domain: domainNorm, selector: selectorNorm },
      })) as unknown as RecordWithSelector[];

      cache.set(cacheKey, result);
      return result;
    } else {
      // Domain-only path (same detailed logging)
      const dsps = await prisma.domainSelectorPair.findMany({
        where: { domain: domainNorm },
        select: { id: true, domain: true, selector: true },
      });

      if (dsps.length === 0) {
        cache.set(cacheKey, []);
        return [];
      }

      const dkimRecords = await prisma.dkimRecord.findMany({
        where: { domainSelectorPairId: { in: dsps.map((dsp) => dsp.id) } },
        select: {
          domainSelectorPairId: true,
          firstSeenAt: true,
          lastSeenAt: true,
          value: true,
        },
      });

      const dspMap = new Map(dsps.map((dsp) => [dsp.id, dsp]));
      const filtered = dkimRecords.filter((record) => record.value !== 'p=');
      const result = filtered.map((record) => {
        const dsp = dspMap.get(record.domainSelectorPairId)!;
        return {
          firstSeenAt: record.firstSeenAt,
          lastSeenAt: record.lastSeenAt,
          value: record.value,
          domainSelectorPair: { domain: dsp.domain, selector: dsp.selector },
        };
      }) as unknown as RecordWithSelector[];

      cache.set(cacheKey, result);
      return result;
    }
  })();

  inFlightRequests.set(cacheKey, p);
  try {
    return await p;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

// Function to clear cache when data is updated
export function clearRecordsCache(domain?: string, selector?: string) {
  if (domain && selector) {
    const domainNorm = domain.toLowerCase();
    const selectorNorm = selector.toLowerCase();
    const cacheKey = generateCacheKey(domainNorm, selectorNorm);
    domainSelectorCache.delete(cacheKey);
    domainCache.delete(domainNorm);
    dspIdCache.delete(cacheKey);
  } else if (domain) {
    const domainNorm = domain.toLowerCase();
    domainCache.delete(domainNorm);
    for (const key of domainSelectorCache.keys()) {
      if (key.startsWith(domainNorm + ':')) {
        domainSelectorCache.delete(key);
      }
    }
    for (const key of dspIdCache.keys()) {
      if (key.startsWith(domainNorm + ':')) {
        dspIdCache.delete(key);
      }
    }
  } else {
    domainCache.clear();
    domainSelectorCache.clear();
    dspIdCache.clear();
  }
}

// Read pre-computed stats from DB (instant)
export async function getArchiveStats(): Promise<ArchiveStats> {
  const cached = statsCache.get('stats');
  if (cached) return cached;

  const record = await prisma.statsCache.findFirst({ where: { id: 1 } });

  const stats: ArchiveStats = record
    ? {
        uniqueDomains: record.uniqueDomains,
        uniqueSelectors: record.uniqueSelectors,
        domainSelectorPairs: record.domainSelectorPairs,
        dkimKeys: record.dkimKeys,
      }
    : {
        uniqueDomains: 0,
        uniqueSelectors: 0,
        domainSelectorPairs: 0,
        dkimKeys: 0,
      };

  statsCache.set('stats', stats);
  return stats;
}

// Heavy computation - call via cron/API, not on page load
export async function refreshArchiveStats(): Promise<ArchiveStats> {
  // Use pg_class reltuples for fast approximate counts (updated by ANALYZE/VACUUM)
  const result = await prisma.$queryRaw<
    [
      {
        unique_domains: number | null;
        unique_selectors: number | null;
        dsp_count: number | null;
        dkim_count: number | null;
      },
    ]
  >`
    SELECT
      (SELECT CASE
        WHEN n_distinct < 0 THEN (reltuples * ABS(n_distinct))::int
        ELSE n_distinct::int
       END
       FROM pg_stats ps JOIN pg_class pc ON ps.tablename = pc.relname
       WHERE ps.tablename = 'DomainSelectorPair' AND ps.attname = 'domain') as unique_domains,
      (SELECT CASE
        WHEN n_distinct < 0 THEN (reltuples * ABS(n_distinct))::int
        ELSE n_distinct::int
       END
       FROM pg_stats ps JOIN pg_class pc ON ps.tablename = pc.relname
       WHERE ps.tablename = 'DomainSelectorPair' AND ps.attname = 'selector') as unique_selectors,
      (SELECT reltuples::int FROM pg_class WHERE relname = 'DomainSelectorPair') as dsp_count,
      (SELECT reltuples::int FROM pg_class WHERE relname = 'DkimRecord') as dkim_count
  `;

  const stats: ArchiveStats = {
    uniqueDomains: Number(result[0].unique_domains) || 0,
    uniqueSelectors: Number(result[0].unique_selectors) || 0,
    domainSelectorPairs: Number(result[0].dsp_count) || 0,
    dkimKeys: Number(result[0].dkim_count) || 0,
  };

  await prisma.statsCache.upsert({
    where: { id: 1 },
    update: { ...stats },
    create: { id: 1, ...stats },
  });

  statsCache.delete('stats');
  return stats;
}
